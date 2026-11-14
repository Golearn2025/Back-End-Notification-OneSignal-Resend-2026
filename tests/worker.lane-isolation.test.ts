import { describe, expect, it, vi } from 'vitest';
import { PollingWorker } from '../src/modules/worker/polling-worker.js';
import { WorkerManager } from '../src/modules/worker/worker-manager.js';
import type { NotificationEvent } from '../src/modules/notifications/notification.types.js';
import { fakeAdminEnqueueCampaign, fakeAdminEnqueueIndividual } from './helpers/admin-enqueue.fake.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeEvent(partial: Partial<NotificationEvent> & Pick<NotificationEvent, 'id' | 'event_type'>): NotificationEvent {
  return {
    organization_id: 'org-1',
    source_module: 'test',
    priority: 'normal',
    status: 'pending',
    customer_id: null,
    payload: {},
    ...partial
  } as NotificationEvent;
}

describe('WorkerManager + PollingWorker lane isolation', () => {
  it('detects admin backlog when category budget fills but total batchSize is not reached', async () => {
    const adminEvents = Array.from({ length: 100 }, (_, i) =>
      makeEvent({
        id: `a-${i}`,
        event_type: 'admin_driver_system',
        payload: { campaign_scope: 'individual', push_title: 'C', push_body: 'B' },
        driver_id: `d-${i}`
      })
    );

    const getPendingEventsFiltered = vi.fn(async (input: { limit: number; includeEventTypes?: string[] }) => {
      if (input.includeEventTypes?.includes('admin_driver_system')) {
        return adminEvents.slice(0, input.limit);
      }
      return [];
    });

    const adminGate = deferred();
    const adminBatchFn = vi.fn(async () => {
      await adminGate.promise;
    });

    const worker = new PollingWorker(
      {
        reclaimStuckProcessing: vi.fn(async () => 0),
        getPendingEventsFiltered,
        getPendingEventsByCampaignId: vi.fn(async () => []),
        claimEventForProcessing: vi.fn(async (id: string) =>
          adminEvents.find((e) => e.id === id)
            ? { ...adminEvents.find((e) => e.id === id)!, status: 'processing' }
            : null
        ),
        markEventFailedRetryable: vi.fn(),
        mergeEventPayload: vi.fn()
      } as any,
      { process: vi.fn() } as any,
      {} as any,
      adminBatchFn as any
    );

    const stats = await worker.runOnce(20);
    expect(stats.backlog.admin).toBe(true);
    expect(stats.lanes.adminBusy).toBe(true);

    adminGate.resolve();
    await worker.waitForLane('admin');
  });

  it('processes Direct + normal-priority individual while campaign blocked', async () => {
    const order: string[] = [];
    const campaignGate = deferred();
    const campaignStarted = deferred();
    const store = new Map<string, NotificationEvent>();

    const { events } = fakeAdminEnqueueCampaign({
      organizationId: 'org-1',
      driverIds: Array.from({ length: 30 }, (_, i) => `cd-${i}`),
      title: 'Campaign',
      body: 'Bulk'
    });
    for (const e of events) store.set(e.id, e);

    const getPendingEventsFiltered = vi.fn(async (input: {
      limit: number;
      includeEventTypes?: string[];
      excludeEventTypes?: string[];
    }) => {
      const all = [...store.values()].filter((e) => e.status === 'pending' || e.status === 'ready');
      let filtered = all;
      if (input.includeEventTypes?.length) {
        filtered = all.filter((e) => input.includeEventTypes!.includes(String(e.event_type)));
      }
      if (input.excludeEventTypes?.length) {
        filtered = all.filter((e) => !input.excludeEventTypes!.includes(String(e.event_type)));
      }
      return filtered.slice(0, input.limit);
    });

    const getPendingEventsByCampaignId = vi.fn(async (id: string) =>
      [...store.values()].filter(
        (e) => (e.status === 'pending' || e.status === 'ready') && e.payload?.campaign_id === id
      )
    );

    const claimEventForProcessing = vi.fn(async (id: string) => {
      const row = store.get(id);
      if (!row || row.status === 'processing' || row.status === 'delivered') return null;
      const claimed = { ...row, status: 'processing' as const };
      store.set(id, claimed);
      return claimed;
    });

    const processor = {
      process: vi.fn(async (event: NotificationEvent) => {
        if (event.event_type === 'driver_job_available') {
          order.push('direct_processed');
          store.set(event.id, { ...event, status: 'delivered' });
        }
      })
    };

    const adminBatchFn = vi.fn(async ({ events: batch }: { events: NotificationEvent[] }) => {
      if (batch.every((e) => e.payload?.campaign_scope === 'individual')) {
        order.push('individual_processed');
        for (const e of batch) store.set(e.id, { ...e, status: 'delivered' });
        return;
      }
      order.push(`admin_batch_started:${batch.length}`);
      campaignStarted.resolve();
      await campaignGate.promise;
      order.push('admin_batch_finished');
      for (const e of batch) store.set(e.id, { ...e, status: 'delivered' });
    });

    const pollingWorker = new PollingWorker(
      {
        reclaimStuckProcessing: vi.fn(async () => 0),
        getPendingEventsFiltered,
        getPendingEventsByCampaignId,
        claimEventForProcessing,
        markEventFailedRetryable: vi.fn(),
        mergeEventPayload: vi.fn()
      } as any,
      processor as any,
      {} as any,
      adminBatchFn as any
    );

    const manager = new WorkerManager({
      mode: 'loop',
      pollIntervalMs: 50,
      batchSize: 20,
      wakeUpDebounceMs: 5,
      pollingWorker,
      retryWorker: { runOnce: async () => undefined },
      logger: { info: () => undefined, warn: () => undefined }
    });

    const runPromise = manager.start();
    await campaignStarted.promise;

    store.set(
      'direct-1',
      makeEvent({
        id: 'direct-1',
        event_type: 'driver_job_available',
        priority: 'critical',
        driver_id: 'driver-direct',
        payload: { dispatch_wave: 'direct' }
      })
    );
    const individual = fakeAdminEnqueueIndividual({
      organizationId: 'org-1',
      driverId: 'driver-ind',
      title: 'Hi',
      body: 'Only you',
      eventId: 'ind-1'
    });
    expect(individual.priority).toBe('normal');
    store.set(individual.id, individual);

    manager.requestWakeUp('inject');

    const deadline = Date.now() + 4000;
    while (
      Date.now() < deadline &&
      (!order.includes('direct_processed') || !order.includes('individual_processed'))
    ) {
      manager.requestWakeUp('poll');
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(order).toContain('direct_processed');
    expect(order).toContain('individual_processed');
    expect(order).not.toContain('admin_batch_finished');

    campaignGate.resolve();
    await pollingWorker.waitForLane('admin');
    expect(order.indexOf('direct_processed')).toBeLessThan(order.indexOf('admin_batch_finished'));
    expect(order.indexOf('individual_processed')).toBeLessThan(order.indexOf('admin_batch_finished'));

    manager.stop();
    await runPromise;
  });
});

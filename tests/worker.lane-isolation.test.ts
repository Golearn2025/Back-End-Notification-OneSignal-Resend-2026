import { describe, expect, it, vi } from 'vitest';
import { PollingWorker } from '../src/modules/worker/polling-worker.js';
import { WorkerManager } from '../src/modules/worker/worker-manager.js';
import type { NotificationEvent } from '../src/modules/notifications/notification.types.js';

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

const priorityRank: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
};

describe('WorkerManager + PollingWorker lane isolation', () => {
  it('detects admin backlog when category budget fills but total batchSize is not reached', async () => {
    const adminEvents = Array.from({ length: 100 }, (_, i) =>
      makeEvent({
        id: `a-${i}`,
        event_type: 'admin_driver_system',
        payload: { push_title: 'C', push_body: 'B' },
        driver_id: `d-${i}`
      })
    );

    const getPendingEventsFiltered = vi.fn(async (input: { limit: number; includeEventTypes?: string[] }) => {
      if (input.includeEventTypes?.includes('admin_driver_system')) {
        return adminEvents.slice(0, input.limit);
      }
      if (input.includeEventTypes?.some((t) => t.startsWith('driver_job'))) {
        return [];
      }
      return [];
    });

    const reclaimStuckProcessing = vi.fn(async () => 0);
    const claimEventForProcessing = vi.fn(async (id: string) =>
      adminEvents.find((e) => e.id === id)
        ? { ...adminEvents.find((e) => e.id === id)!, status: 'processing' }
        : null
    );

    const adminGate = deferred();
    const adminBatchFn = vi.fn(async () => {
      await adminGate.promise;
    });

    const worker = new PollingWorker(
      {
        reclaimStuckProcessing,
        getPendingEventsFiltered,
        claimEventForProcessing,
        markEventFailedRetryable: vi.fn()
      } as any,
      { process: vi.fn() } as any,
      {} as any,
      adminBatchFn as any
    );

    const stats = await worker.runOnce(20);
    // otherBudget = 10, probe limit = 11 → category backlog even though fetched << 100
    expect(stats.backlog.admin).toBe(true);
    expect(stats.lanes.adminBusy).toBe(true);
    // Manager must not take the full poll sleep while backlog/lanesBusy (brief yield instead).

    adminGate.resolve();
    await worker.waitForLane('admin');
  });

  it('processes Direct + individual after campaign started but before campaign unblocks (real manager)', async () => {
    const order: string[] = [];
    const campaignGate = deferred();
    const campaignStarted = deferred();

    const store = new Map<string, NotificationEvent>();

    for (let i = 0; i < 30; i += 1) {
      store.set(
        `camp-${String(i).padStart(3, '0')}`,
        makeEvent({
          id: `camp-${String(i).padStart(3, '0')}`,
          event_type: 'admin_driver_system',
          priority: 'normal',
          driver_id: `cd-${i}`,
          payload: { push_title: 'Campaign', push_body: 'Bulk' }
        })
      );
    }

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
      filtered.sort((a, b) => {
        const pa = priorityRank[String(a.priority)] ?? 2;
        const pb = priorityRank[String(b.priority)] ?? 2;
        if (pa !== pb) {
          return pa - pb;
        }
        return String(a.id).localeCompare(String(b.id));
      });
      return filtered.slice(0, input.limit);
    });

    const claimEventForProcessing = vi.fn(async (id: string) => {
      const row = store.get(id);
      if (!row || (row.status !== 'pending' && row.status !== 'ready' && row.status !== 'failed_retryable')) {
        return null;
      }
      const claimed = { ...row, status: 'processing' as const };
      store.set(id, claimed);
      return claimed;
    });

    const processor = {
      process: vi.fn(async (event: NotificationEvent) => {
        if (event.event_type === 'driver_job_available') {
          order.push('direct_processed');
          store.set(event.id, { ...event, status: 'delivered' });
          return;
        }
        store.set(event.id, { ...event, status: 'delivered' });
      })
    };

    const adminBatchFn = vi.fn(async ({ events }: { events: NotificationEvent[] }) => {
      const isIndividual = events.some((e) => e.id.startsWith('ind-'));
      if (isIndividual) {
        order.push('individual_processed');
        for (const event of events) {
          store.set(event.id, { ...event, status: 'delivered' });
        }
        return;
      }
      order.push(`admin_batch_started:${events.length}`);
      campaignStarted.resolve();
      await campaignGate.promise;
      order.push('admin_batch_finished');
      for (const event of events) {
        store.set(event.id, { ...event, status: 'delivered' });
      }
    });

    const pollingWorker = new PollingWorker(
      {
        reclaimStuckProcessing: vi.fn(async () => 0),
        getPendingEventsFiltered,
        claimEventForProcessing,
        markEventFailedRetryable: vi.fn()
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

    // Wait until campaign lane is blocked on provider.
    await campaignStarted.promise;
    expect(order.some((x) => x.startsWith('admin_batch_started'))).toBe(true);
    expect(order).not.toContain('admin_batch_finished');

    // Inject Direct + individual while campaign still blocked.
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
    store.set(
      'ind-1',
      makeEvent({
        id: 'ind-1',
        event_type: 'admin_driver_system',
        priority: 'high',
        driver_id: 'driver-ind',
        payload: { push_title: 'Hi', push_body: 'Only you' }
      })
    );

    manager.requestWakeUp('inject_direct_and_individual');

    const deadline = Date.now() + 4000;
    while (
      Date.now() < deadline &&
      (!order.includes('direct_processed') || !order.includes('individual_processed'))
    ) {
      manager.requestWakeUp('poll_lanes');
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(order).toContain('direct_processed');
    expect(order).toContain('individual_processed');
    expect(order).not.toContain('admin_batch_finished');
    expect(order.indexOf('direct_processed')).toBeLessThan(
      order.includes('admin_batch_finished') ? order.indexOf('admin_batch_finished') : Number.POSITIVE_INFINITY
    );
    expect(order.indexOf('individual_processed')).toBeLessThan(
      order.includes('admin_batch_finished') ? order.indexOf('admin_batch_finished') : Number.POSITIVE_INFINITY
    );

    campaignGate.resolve();
    await pollingWorker.waitForLane('admin');
    expect(order).toContain('admin_batch_finished');
    expect(order.indexOf('direct_processed')).toBeLessThan(order.indexOf('admin_batch_finished'));
    expect(order.indexOf('individual_processed')).toBeLessThan(order.indexOf('admin_batch_finished'));

    manager.stop();
    await runPromise;
  });
});

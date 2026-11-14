import { describe, expect, it, vi } from 'vitest';
import { processAdminDriverNotificationBatch } from '../../src/modules/notifications/handlers/process-admin-driver-notification-batch.js';
import { isOneSignalIdempotencyKey } from '../../src/modules/notifications/onesignal-idempotency.js';
import { PollingWorker } from '../../src/modules/worker/polling-worker.js';
import { WorkerManager } from '../../src/modules/worker/worker-manager.js';
import { fakeAdminEnqueueCampaign, fakeAdminEnqueueIndividual } from '../helpers/admin-enqueue.fake.js';
import type { NotificationEvent } from '../../src/modules/notifications/notification.types.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createDedupingFakeOneSignal() {
  const sends: Array<{
    externalUserIds: string[];
    title: string;
    message: string;
    idempotencyKey: string;
  }> = [];
  const byKey = new Map<string, { providerMessageId: string; audience: string[] }>();

  const sendPushToExternalUserIds = vi.fn(async (input: {
    externalUserIds: string[];
    title: string;
    message: string;
    idempotencyKey?: string;
  }) => {
    const key = String(input.idempotencyKey ?? '');
    if (!isOneSignalIdempotencyKey(key)) {
      throw new Error('idempotency_key must be a UUID');
    }
    const audience = [...input.externalUserIds].sort();
    sends.push({
      externalUserIds: audience,
      title: input.title,
      message: input.message,
      idempotencyKey: key
    });
    const existing = byKey.get(key);
    if (existing) {
      // Deduplicate: same UUID → same provider message, no second notification.
      return {
        providerMessageId: existing.providerMessageId,
        idempotencyKey: key,
        responseMetadata: { invalidExternalIds: [], deduped: true }
      };
    }
    const providerMessageId = `os-${key.slice(0, 8)}`;
    byKey.set(key, { providerMessageId, audience });
    return {
      providerMessageId,
      idempotencyKey: key,
      responseMetadata: { invalidExternalIds: [] }
    };
  });

  return { sendPushToExternalUserIds, sends, byKey };
}

describe('admin campaign → single OneSignal + distinct campaign ids', () => {
  it('1000-driver campaign: worker prepares full audience → one provider request', async () => {
    const driverIds = Array.from({ length: 1000 }, (_, i) => `d-${i}`);
    const { campaignId, events } = fakeAdminEnqueueCampaign({
      organizationId: 'org-1',
      driverIds,
      title: 'Fleet update',
      body: 'Please confirm'
    });

    const store = new Map(events.map((e) => [e.id, { ...e }]));
    const onesignal = createDedupingFakeOneSignal();

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
        filtered = filtered.filter((e) => !input.excludeEventTypes!.includes(String(e.event_type)));
      }
      return filtered.slice(0, input.limit);
    });
    const getPendingEventsByCampaignId = vi.fn(async (id: string) =>
      [...store.values()].filter(
        (e) =>
          (e.status === 'pending' || e.status === 'ready' || e.status === 'failed_retryable') &&
          e.payload?.campaign_id === id
      )
    );
    const claimEventForProcessing = vi.fn(async (id: string) => {
      const row = store.get(id);
      if (!row || (row.status !== 'pending' && row.status !== 'ready' && row.status !== 'failed_retryable')) {
        return null;
      }
      const claimed = { ...row, status: 'processing' as const };
      store.set(id, claimed);
      return claimed;
    });
    const mergeEventPayload = vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const row = store.get(id);
      if (!row) return;
      store.set(id, { ...row, payload: { ...row.payload, ...patch } });
    });
    const markEventDelivered = vi.fn(async (id: string) => {
      const row = store.get(id);
      if (row) store.set(id, { ...row, status: 'delivered' });
    });

    let driverLookup = 0;
    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => {
          const n = driverLookup;
          driverLookup += 1;
          return { data: { auth_user_id: `auth-${n}` }, error: null };
        })
      }))
    };

    const deliveriesRepository = {
      createDelivery: vi.fn(async (input: any) => ({
        id: `del-${input.recipient_id}`,
        status: 'queued',
        ...input
      })),
      markDeliverySending: vi.fn(),
      markDeliveryProviderAccepted: vi.fn(),
      markDeliveryFailedRetryable: vi.fn(),
      markDeliveryFailedFinal: vi.fn()
    };

    const adminBatchFn = async ({ events: batch }: { events: NotificationEvent[] }) => {
      await processAdminDriverNotificationBatch({
        events: batch,
        eventsRepository: {
          markEventDelivered,
          markEventFailedRetryable: vi.fn(),
          markEventDeadLetter: vi.fn(),
          mergeEventPayload
        } as any,
        deliveriesRepository: deliveriesRepository as any,
        oneSignal: { sendPushToExternalUserIds: onesignal.sendPushToExternalUserIds } as any,
        db: db as any
      });
    };

    const worker = new PollingWorker(
      {
        reclaimStuckProcessing: vi.fn(async () => 0),
        getPendingEventsFiltered,
        getPendingEventsByCampaignId,
        claimEventForProcessing,
        markEventFailedRetryable: vi.fn(),
        mergeEventPayload
      } as any,
      { process: vi.fn() } as any,
      {} as any,
      adminBatchFn as any
    );

    const manager = new WorkerManager({
      mode: 'once',
      batchSize: 20,
      pollingWorker: worker,
      retryWorker: { runOnce: async () => undefined },
      logger: { info: () => undefined, warn: () => undefined }
    });

    await manager.start();
    await worker.waitForLane('admin');

    expect(getPendingEventsByCampaignId).toHaveBeenCalledWith(campaignId, expect.any(Number));
    expect(onesignal.sendPushToExternalUserIds).toHaveBeenCalledTimes(1);
    expect(onesignal.sends[0]?.externalUserIds).toHaveLength(1000);
    expect(isOneSignalIdempotencyKey(onesignal.sends[0]?.idempotencyKey ?? '')).toBe(true);
    expect(markEventDelivered).toHaveBeenCalledTimes(1000);
  });

  it('two intentional campaigns with the same text get distinct identities and two sends', async () => {
    const onesignal = createDedupingFakeOneSignal();
    const a = fakeAdminEnqueueCampaign({
      organizationId: 'org-1',
      driverIds: ['d1', 'd2'],
      title: 'Same title',
      body: 'Same body',
      campaignId: '11111111-1111-1111-1111-111111111111'
    });
    const b = fakeAdminEnqueueCampaign({
      organizationId: 'org-1',
      driverIds: ['d3', 'd4'],
      title: 'Same title',
      body: 'Same body',
      campaignId: '22222222-2222-2222-2222-222222222222'
    });

    const mergeEventPayload = vi.fn(async () => undefined);
    let driverLookup = 0;
    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => {
          driverLookup += 1;
          return { data: { auth_user_id: `auth-${driverLookup}` }, error: null };
        })
      }))
    };
    const deliveries = {
      createDelivery: vi.fn(async (input: any) => ({
        id: `del-${input.event_id}`,
        status: 'queued',
        ...input
      })),
      markDeliverySending: vi.fn(),
      markDeliveryProviderAccepted: vi.fn(),
      markDeliveryFailedRetryable: vi.fn(),
      markDeliveryFailedFinal: vi.fn()
    };

    await processAdminDriverNotificationBatch({
      events: [...a.events, ...b.events] as any,
      eventsRepository: {
        markEventDelivered: vi.fn(),
        markEventFailedRetryable: vi.fn(),
        markEventDeadLetter: vi.fn(),
        mergeEventPayload
      } as any,
      deliveriesRepository: deliveries as any,
      oneSignal: { sendPushToExternalUserIds: onesignal.sendPushToExternalUserIds } as any,
      db: db as any
    });

    expect(onesignal.sendPushToExternalUserIds).toHaveBeenCalledTimes(2);
    expect(onesignal.sends[0]?.idempotencyKey).not.toBe(onesignal.sends[1]?.idempotencyKey);
    expect(a.campaignId).not.toBe(b.campaignId);
  });

  it('provider UUID dedupe: accept then partial DB fail then retry does not create a second send', async () => {
    const onesignal = createDedupingFakeOneSignal();
    const { events } = fakeAdminEnqueueCampaign({
      organizationId: 'org-1',
      driverIds: ['d1', 'd2'],
      title: 'T',
      body: 'B',
      campaignId: '33333333-3333-3333-3333-333333333333'
    });

    const payloads = new Map(events.map((e) => [e.id, { ...e.payload }]));
    const mergeEventPayload = vi.fn(async (id: string, patch: Record<string, unknown>) => {
      payloads.set(id, { ...(payloads.get(id) ?? {}), ...patch });
    });

    const markDeliveryProviderAccepted = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db down'))
      // retry pass
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    let driverLookup = 0;
    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => {
          driverLookup += 1;
          return { data: { auth_user_id: `auth-${driverLookup}` }, error: null };
        })
      }))
    };
    const deliveries = {
      createDelivery: vi.fn(async (input: any) => ({
        id: `del-${input.recipient_id}`,
        status: 'queued',
        ...input
      })),
      markDeliverySending: vi.fn(),
      markDeliveryProviderAccepted,
      markDeliveryFailedRetryable: vi.fn(),
      markDeliveryFailedFinal: vi.fn()
    };
    const eventsRepository = {
      markEventDelivered: vi.fn(),
      markEventFailedRetryable: vi.fn(),
      markEventDeadLetter: vi.fn(),
      mergeEventPayload
    };

    const withPayload = () =>
      events.map((e) => ({ ...e, payload: { ...payloads.get(e.id) }, status: 'processing' }));

    await processAdminDriverNotificationBatch({
      events: withPayload() as any,
      eventsRepository: eventsRepository as any,
      deliveriesRepository: deliveries as any,
      oneSignal: { sendPushToExternalUserIds: onesignal.sendPushToExternalUserIds } as any,
      db: db as any
    });

    expect(onesignal.sendPushToExternalUserIds).toHaveBeenCalledTimes(1);
    const firstKey = onesignal.sends[0]?.idempotencyKey;
    expect(isOneSignalIdempotencyKey(firstKey ?? '')).toBe(true);
    expect(onesignal.sends[0]?.externalUserIds).toEqual(['auth-1', 'auth-2']);

    // Retry remaining (and re-prepare) — must reuse same UUID + full original audience.
    driverLookup = 0;
    await processAdminDriverNotificationBatch({
      events: withPayload() as any,
      eventsRepository: eventsRepository as any,
      deliveriesRepository: {
        ...deliveries,
        createDelivery: vi.fn(async (input: any) => ({
          id: `del-${input.recipient_id}`,
          // first already accepted in real life; keep both queued for this unit path
          status: input.recipient_id === 'd1' ? 'provider_accepted' : 'queued',
          ...input
        }))
      } as any,
      oneSignal: { sendPushToExternalUserIds: onesignal.sendPushToExternalUserIds } as any,
      db: db as any
    });

    expect(onesignal.sendPushToExternalUserIds).toHaveBeenCalledTimes(2);
    expect(onesignal.sends[1]?.idempotencyKey).toBe(firstKey);
    expect(onesignal.sends[1]?.externalUserIds).toEqual(['auth-1', 'auth-2']);
    expect(onesignal.byKey.size).toBe(1);
  });
});

describe('lane isolation with real enqueue priority + blocked email', () => {
  it('blocked email does not prevent later Direct from completing first', async () => {
    const order: string[] = [];
    const emailGate = deferred();
    const emailStarted = deferred();
    const store = new Map<string, NotificationEvent>();

    store.set('email-1', {
      id: 'email-1',
      organization_id: 'org-1',
      event_type: 'booking_payment_confirmed',
      source_module: 'payments',
      priority: 'normal',
      status: 'pending',
      customer_id: 'c1',
      payload: {}
    } as NotificationEvent);

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

    const claimEventForProcessing = vi.fn(async (id: string) => {
      const row = store.get(id);
      if (!row || row.status === 'processing' || row.status === 'delivered') return null;
      const claimed = { ...row, status: 'processing' as const };
      store.set(id, claimed);
      return claimed;
    });

    const processor = {
      process: vi.fn(async (event: NotificationEvent) => {
        if (event.event_type === 'booking_payment_confirmed') {
          order.push('email_started');
          emailStarted.resolve();
          await emailGate.promise;
          order.push('email_finished');
          store.set(event.id, { ...event, status: 'delivered' });
          return;
        }
        if (event.event_type === 'driver_job_available') {
          order.push('direct_processed');
          store.set(event.id, { ...event, status: 'delivered' });
        }
      })
    };

    const worker = new PollingWorker(
      {
        reclaimStuckProcessing: vi.fn(async () => 0),
        getPendingEventsFiltered,
        getPendingEventsByCampaignId: vi.fn(async () => []),
        claimEventForProcessing,
        markEventFailedRetryable: vi.fn(),
        mergeEventPayload: vi.fn()
      } as any,
      processor as any,
      {} as any,
      vi.fn() as any
    );

    const manager = new WorkerManager({
      mode: 'loop',
      pollIntervalMs: 40,
      batchSize: 20,
      wakeUpDebounceMs: 5,
      pollingWorker: worker,
      retryWorker: { runOnce: async () => undefined },
      logger: { info: () => undefined, warn: () => undefined }
    });

    const runPromise = manager.start();
    await emailStarted.promise;

    store.set('direct-1', {
      id: 'direct-1',
      organization_id: 'org-1',
      event_type: 'driver_job_available',
      source_module: 'dispatch',
      priority: 'critical',
      status: 'pending',
      customer_id: null,
      driver_id: 'd-direct',
      payload: { dispatch_wave: 'direct' }
    } as NotificationEvent);
    manager.requestWakeUp('inject_direct');

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !order.includes('direct_processed')) {
      manager.requestWakeUp('poll');
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(order).toContain('direct_processed');
    expect(order).not.toContain('email_finished');
    expect(order.indexOf('direct_processed')).toBeLessThan(
      order.includes('email_finished') ? order.indexOf('email_finished') : Number.POSITIVE_INFINITY
    );

    emailGate.resolve();
    await worker.waitForLane('email');
    expect(order).toContain('email_finished');
    expect(order.indexOf('direct_processed')).toBeLessThan(order.indexOf('email_finished'));

    manager.stop();
    await runPromise;
  });

  it('blocked campaign does not block individual created with live enqueue rules (priority=normal)', async () => {
    const order: string[] = [];
    const campaignGate = deferred();
    const campaignStarted = deferred();
    const store = new Map<string, NotificationEvent>();

    const { campaignId, events } = fakeAdminEnqueueCampaign({
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
        (e) =>
          (e.status === 'pending' || e.status === 'ready') && e.payload?.campaign_id === id
      )
    );
    const claimEventForProcessing = vi.fn(async (id: string) => {
      const row = store.get(id);
      if (!row || row.status === 'processing' || row.status === 'delivered') return null;
      const claimed = { ...row, status: 'processing' as const };
      store.set(id, claimed);
      return claimed;
    });

    const adminBatchFn = vi.fn(async ({ events: batch }: { events: NotificationEvent[] }) => {
      const isIndividual = batch.every((e) => e.payload?.campaign_scope === 'individual');
      if (isIndividual) {
        order.push('individual_processed');
        for (const e of batch) store.set(e.id, { ...e, status: 'delivered' });
        return;
      }
      order.push(`campaign_started:${batch.length}:${campaignId}`);
      campaignStarted.resolve();
      await campaignGate.promise;
      order.push('campaign_finished');
      for (const e of batch) store.set(e.id, { ...e, status: 'delivered' });
    });

    const worker = new PollingWorker(
      {
        reclaimStuckProcessing: vi.fn(async () => 0),
        getPendingEventsFiltered,
        getPendingEventsByCampaignId,
        claimEventForProcessing,
        markEventFailedRetryable: vi.fn(),
        mergeEventPayload: vi.fn()
      } as any,
      { process: vi.fn() } as any,
      {} as any,
      adminBatchFn as any
    );

    const manager = new WorkerManager({
      mode: 'loop',
      pollIntervalMs: 40,
      batchSize: 20,
      wakeUpDebounceMs: 5,
      pollingWorker: worker,
      retryWorker: { runOnce: async () => undefined },
      logger: { info: () => undefined, warn: () => undefined }
    });

    const runPromise = manager.start();
    await campaignStarted.promise;
    expect(order.some((x) => x.startsWith('campaign_started:30'))).toBe(true);

    const individual = fakeAdminEnqueueIndividual({
      organizationId: 'org-1',
      driverId: 'driver-ind',
      title: 'Hi',
      body: 'Only you',
      eventId: 'ind-1'
    });
    expect(individual.priority).toBe('normal');
    expect(individual.payload.campaign_id).toBeUndefined();
    store.set(individual.id, individual);
    manager.requestWakeUp('inject_individual');

    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !order.includes('individual_processed')) {
      manager.requestWakeUp('poll');
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(order).toContain('individual_processed');
    expect(order).not.toContain('campaign_finished');

    campaignGate.resolve();
    await worker.waitForLane('admin');
    expect(order.indexOf('individual_processed')).toBeLessThan(order.indexOf('campaign_finished'));

    manager.stop();
    await runPromise;
  });
});

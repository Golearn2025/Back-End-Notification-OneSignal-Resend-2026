import { describe, expect, it, vi } from 'vitest';
import { processAdminDriverNotificationBatch } from '../../src/modules/notifications/handlers/process-admin-driver-notification-batch.js';
import { processDriverJobAvailable } from '../../src/modules/notifications/handlers/process-driver-job-available.handler.js';

/**
 * Simulation limits (explicit):
 * - Fake providers only; no real OneSignal/Resend/network.
 * - Timings are relative (Promise delays), not wall-clock SLAs for phones.
 * - Does not prove device receipt — only that categories are not blocked by a slow peer.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('latency concurrency simulation (fake providers)', () => {
  it('slow admin campaign does not block Direct job + individual admin + email path completion order', async () => {
    const order: string[] = [];
    const slowAdminGate = deferred<void>();

    const campaignReachedProvider = deferred<void>();
    const slowBulk = vi.fn(async () => {
      order.push('admin_campaign_started');
      campaignReachedProvider.resolve();
      await slowAdminGate.promise;
      order.push('admin_campaign_finished');
      return { providerMessageId: 'camp-1', responseMetadata: { invalidExternalIds: [] } };
    });

    const fastDirect = vi.fn(async () => {
      order.push('direct_job_sent');
      return { providerMessageId: 'direct-1', responseMetadata: { invalidExternalIds: [] } };
    });

    const fastIndividual = vi.fn(async () => {
      order.push('individual_admin_sent');
      return { providerMessageId: 'ind-1', responseMetadata: { invalidExternalIds: [] } };
    });

    const fakeEmail = vi.fn(async () => {
      order.push('ops_email_sent');
      return { providerMessageId: 'email-1' };
    });

    // Build 100 identical admin campaign events (shared title/body → one bulk call).
    const campaignEvents = Array.from({ length: 100 }, (_, i) => ({
      id: `camp-${i}`,
      organization_id: 'org-1',
      event_type: 'admin_driver_system',
      source_module: 'admin_communications',
      priority: 'normal',
      status: 'processing',
      customer_id: null,
      driver_id: `d-${i}`,
      payload: {
        push_title: 'Campaign',
        push_body: 'Bulk test'
      }
    }));

    let driverLookup = 0;
    const campaignDb = {
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

    const campaignPromise = processAdminDriverNotificationBatch({
      events: campaignEvents as any,
      eventsRepository: {
        markEventDelivered: vi.fn(),
        markEventFailedRetryable: vi.fn(),
        markEventDeadLetter: vi.fn()
      } as any,
      deliveriesRepository: {
        createDelivery: vi.fn(async (input: any) => ({
          ...input,
          id: `del-${input.recipient_id}`,
          status: 'queued'
        })),
        markDeliverySending: vi.fn(),
        markDeliveryProviderAccepted: vi.fn(),
        markDeliveryFailedRetryable: vi.fn(),
        markDeliveryFailedFinal: vi.fn()
      } as any,
      oneSignal: { sendPushToExternalUserIds: slowBulk } as any,
      db: campaignDb as any
    });

    // Wait until campaign hits the slow provider, then run concurrent categories.
    await campaignReachedProvider.promise;

    const directPromise = processDriverJobAvailable(
      {
        event: {
          id: 'direct-1',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          source_module: 'dispatch',
          priority: 'critical',
          status: 'processing',
          customer_id: null,
          driver_id: 'driver-direct',
          payload: {
            dispatch_wave: 'direct',
            booking_reference: 'CB-DIRECT',
            booking_type: 'oneway',
            push_title: 'Reserved',
            push_message: 'Direct'
          }
        } as any,
        eventsRepository: {
          markEventDelivered: vi.fn(),
          markEventFailedRetryable: vi.fn(),
          markEventPartiallyDelivered: vi.fn(),
          markEventCancelled: vi.fn(),
          markEventDeadLetter: vi.fn()
        } as any,
        deliveriesRepository: {
          createDelivery: vi.fn(async (input: any) => ({
            id: 'del-direct',
            status: 'queued',
            ...input
          })),
          markDeliverySending: vi.fn(),
          markDeliveryProviderAccepted: vi.fn(),
          markDeliveryFailedRetryable: vi.fn(),
          markDeliveryFailedFinal: vi.fn()
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserIds: fastDirect } as any,
        driverEligibilityService: {
          resolveDriversByIds: vi.fn(async () => [
            { driverId: 'driver-direct', authUserId: 'auth-direct' }
          ]),
          resolveEligibleDrivers: vi.fn(),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: vi.fn(async () => new Set(['auth-direct'])),
          getLatestLegFinancial: vi.fn()
        } as any,
        db: { rpc: vi.fn() } as any
      }
    );

    const individualPromise = processAdminDriverNotificationBatch({
      events: [
        {
          id: 'ind-1',
          organization_id: 'org-1',
          event_type: 'admin_driver_system',
          source_module: 'admin_communications',
          priority: 'high',
          status: 'processing',
          customer_id: null,
          driver_id: 'driver-ind',
          payload: { push_title: 'Hello', push_body: 'Just you' }
        } as any
      ],
      eventsRepository: {
        markEventDelivered: vi.fn(),
        markEventFailedRetryable: vi.fn(),
        markEventDeadLetter: vi.fn()
      } as any,
      deliveriesRepository: {
        createDelivery: vi.fn(async (input: any) => ({
          id: 'del-ind',
          status: 'queued',
          ...input
        })),
        markDeliverySending: vi.fn(),
        markDeliveryProviderAccepted: vi.fn(),
        markDeliveryFailedRetryable: vi.fn(),
        markDeliveryFailedFinal: vi.fn()
      } as any,
      oneSignal: { sendPushToExternalUserIds: fastIndividual } as any,
      db: {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: { auth_user_id: 'auth-ind' }, error: null }))
        }))
      } as any
    });

    const emailPromise = (async () => {
      await fakeEmail();
    })();

    await Promise.all([directPromise, individualPromise, emailPromise]);

    expect(order).toContain('admin_campaign_started');
    expect(order).toContain('direct_job_sent');
    expect(order).toContain('individual_admin_sent');
    expect(order).toContain('ops_email_sent');
    expect(order.indexOf('direct_job_sent')).toBeLessThan(order.length);
    expect(order).not.toContain('admin_campaign_finished');

    slowAdminGate.resolve();
    await campaignPromise;
    expect(order).toContain('admin_campaign_finished');
    expect(order.indexOf('direct_job_sent')).toBeLessThan(order.indexOf('admin_campaign_finished'));
    expect(slowBulk).toHaveBeenCalledTimes(1);
    const calls = slowBulk.mock.calls as unknown as Array<[{ externalUserIds: string[] }]>;
    expect(calls[0]?.[0]?.externalUserIds).toHaveLength(100);
  });

  it('bulk push with partial invalid aliases marks only invalids failed (not all delivered)', async () => {
    const markDeliveryProviderAccepted = vi.fn();
    const markDeliveryFailedRetryable = vi.fn();
    const markEventPartiallyDelivered = vi.fn();

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-partial',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          source_module: 'dispatch',
          priority: 'high',
          status: 'processing',
          customer_id: null,
          driver_id: null,
          payload: {
            dispatch_wave: 'open',
            booking_reference: 'CB-P',
            booking_type: 'oneway',
            push_title: 'New job',
            push_message: 'Open'
          }
        } as any,
        eventsRepository: {
          markEventDelivered: vi.fn(),
          markEventFailedRetryable: vi.fn(),
          markEventPartiallyDelivered,
          markEventCancelled: vi.fn(),
          markEventDeadLetter: vi.fn()
        } as any,
        deliveriesRepository: {
          createDelivery: vi.fn(async (input: any) => ({
            id: `del-${input.recipient_id}`,
            status: 'queued',
            ...input
          })),
          markDeliverySending: vi.fn(),
          markDeliveryProviderAccepted,
          markDeliveryFailedRetryable,
          markDeliveryFailedFinal: vi.fn()
        } as any
      },
      {
        oneSignal: {
          sendPushToExternalUserIds: vi.fn(async () => ({
            providerMessageId: 'bulk-partial',
            responseMetadata: { invalidExternalIds: ['a2'] }
          }))
        } as any,
        driverEligibilityService: {
          resolveEligibleDrivers: vi.fn(async () => [
            { driverId: 'd1', authUserId: 'a1' },
            { driverId: 'd2', authUserId: 'a2' },
            { driverId: 'd3', authUserId: 'a3' }
          ]),
          resolveDriversByIds: vi.fn(),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: vi.fn(async () => new Set(['a1', 'a2', 'a3'])),
          getLatestLegFinancial: vi.fn()
        } as any,
        db: { rpc: vi.fn() } as any
      }
    );

    expect(markDeliveryProviderAccepted).toHaveBeenCalledTimes(2);
    expect(markDeliveryFailedRetryable).toHaveBeenCalledTimes(1);
    expect(markEventPartiallyDelivered).toHaveBeenCalledWith('evt-partial');
  });

  it('provider timeout does not create duplicate deliveries on retry; succeeded stay succeeded', async () => {
    let attempt = 0;
    const createDelivery = vi.fn(async (input: any) => {
      attempt += 1;
      if (attempt === 1) {
        return { ...input, id: `del-${input.recipient_id}`, status: 'queued' };
      }
      // Idempotent repository behavior on retry: existing successful row.
      return { ...input, id: `del-${input.recipient_id}`, status: 'provider_accepted' };
    });

    const send = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('OneSignal timeout'), { retryAfterSeconds: 2 })
      );

    const markDeliveryFailedRetryable = vi.fn();
    const markEventDelivered = vi.fn();
    const markEventFailedRetryable = vi.fn();

    const deps = {
      eventsRepository: {
        markEventDelivered,
        markEventFailedRetryable,
        markEventPartiallyDelivered: vi.fn(),
        markEventCancelled: vi.fn(),
        markEventDeadLetter: vi.fn()
      } as any,
      deliveriesRepository: {
        createDelivery,
        markDeliverySending: vi.fn(),
        markDeliveryProviderAccepted: vi.fn(),
        markDeliveryFailedRetryable,
        markDeliveryFailedFinal: vi.fn()
      } as any
    };

    const event = {
      id: 'evt-timeout',
      organization_id: 'org-1',
      event_type: 'driver_job_available',
      source_module: 'dispatch',
      priority: 'high',
      status: 'processing',
      customer_id: null,
      driver_id: 'd1',
      payload: {
        dispatch_wave: 'direct',
        booking_reference: 'CB-T',
        booking_type: 'oneway',
        push_title: 'T',
        push_message: 'T'
      }
    } as any;

    const runtime = {
      oneSignal: { sendPushToExternalUserIds: send } as any,
      driverEligibilityService: {
        resolveDriversByIds: vi.fn(async () => [{ driverId: 'd1', authUserId: 'a1' }]),
        resolveEligibleDrivers: vi.fn(),
        resolvePremiumDriverIds: vi.fn(),
        resolveActiveExternalUserIds: vi.fn(async () => new Set(['a1'])),
        getLatestLegFinancial: vi.fn()
      } as any,
      db: { rpc: vi.fn() } as any
    };

    await processDriverJobAvailable({ event, ...deps }, runtime);
    expect(markDeliveryFailedRetryable).toHaveBeenCalledTimes(1);
    expect(markEventFailedRetryable).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);

    // Retry: delivery already provider_accepted → no second provider call.
    await processDriverJobAvailable({ event, ...deps }, runtime);
    expect(send).toHaveBeenCalledTimes(1);
    expect(createDelivery).toHaveBeenCalledTimes(2);
    expect(markEventDelivered).toHaveBeenCalledWith('evt-timeout');
  });

  it('fail-closes without send when offerability RPC is missing', async () => {
    const markEventDeadLetter = vi.fn();
    const send = vi.fn();

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-rpc-missing',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          source_module: 'dispatch',
          priority: 'high',
          status: 'processing',
          customer_id: null,
          driver_id: null,
          payload: {
            job_id: 'leg-missing-fn',
            booking_type: 'oneway',
            booking_reference: 'CB-X'
          }
        } as any,
        eventsRepository: {
          markEventDelivered: vi.fn(),
          markEventFailedRetryable: vi.fn(),
          markEventPartiallyDelivered: vi.fn(),
          markEventCancelled: vi.fn(),
          markEventDeadLetter
        } as any,
        deliveriesRepository: {
          createDelivery: vi.fn(),
          markDeliverySending: vi.fn(),
          markDeliveryProviderAccepted: vi.fn(),
          markDeliveryFailedRetryable: vi.fn(),
          markDeliveryFailedFinal: vi.fn()
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserIds: send } as any,
        driverEligibilityService: {
          resolveEligibleDrivers: vi.fn(),
          resolveDriversByIds: vi.fn(),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: vi.fn(),
          getLatestLegFinancial: vi.fn()
        } as any,
        db: {
          rpc: vi.fn(async () => ({
            data: null,
            error: { message: 'function public.job_leg_is_offerable(uuid) does not exist' }
          }))
        } as any
      }
    );

    expect(markEventDeadLetter).toHaveBeenCalledWith(
      'evt-rpc-missing',
      expect.stringContaining('offerability_check_unavailable')
    );
    expect(send).not.toHaveBeenCalled();
  });
});

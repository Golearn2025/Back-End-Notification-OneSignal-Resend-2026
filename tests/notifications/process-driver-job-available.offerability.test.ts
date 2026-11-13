import { describe, expect, it, vi } from 'vitest';
import { processDriverJobAvailable } from '../../src/modules/notifications/handlers/process-driver-job-available.handler.js';

function mockDb(rpcImpl?: (...args: any[]) => Promise<any>) {
  const rpc = rpcImpl ?? vi.fn(async () => ({ data: true, error: null }));
  const result = { data: { leg_kind: 'outbound', leg_number: 1 }, error: null };
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result)
  };
  return {
    rpc,
    from: vi.fn(() => chain)
  };
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const markEventDelivered = vi.fn();
  const markEventFailedRetryable = vi.fn();
  const markEventPartiallyDelivered = vi.fn();
  const markEventCancelled = vi.fn();
  const createDelivery = vi.fn(async (input: any) => ({
    id: `del-${input.recipient_id}`,
    status: 'queued',
    ...input
  }));
  const markDeliverySending = vi.fn();
  const markDeliveryProviderAccepted = vi.fn();
  const markDeliveryFailedRetryable = vi.fn();
  const sendPushToExternalUserId = vi.fn(async ({ externalUserId }: { externalUserId: string }) => ({
    providerMessageId: `msg-${externalUserId}`,
    responseMetadata: {}
  }));
  const resolveDriversByIds = vi.fn(async ({ driverIds }: { driverIds: string[] }) =>
    driverIds.map((id) => ({ driverId: id, authUserId: `auth-${id}` }))
  );
  const resolveActiveExternalUserIds = vi.fn(async ({ authUserIds }: { authUserIds: string[] }) =>
    new Set(authUserIds)
  );

  return {
    markEventDelivered,
    markEventFailedRetryable,
    markEventPartiallyDelivered,
    markEventCancelled,
    createDelivery,
    markDeliverySending,
    markDeliveryProviderAccepted,
    markDeliveryFailedRetryable,
    sendPushToExternalUserId,
    resolveDriversByIds,
    resolveActiveExternalUserIds,
    ...overrides
  };
}

describe('processDriverJobAvailable offerability guard', () => {
  it('cancels and does not send when job_leg_is_offerable=false (accepted/cancelled)', async () => {
    const d = baseDeps();
    const db = mockDb(vi.fn(async () => ({ data: false, error: null })));

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-acc',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          status: 'failed_retryable',
          driver_id: 'd1',
          payload: {
            job_id: 'leg-1',
            booking_id: 'bk-1',
            booking_reference: 'CB-1',
            booking_type: 'oneway',
            dispatch_wave: 'open'
          }
        } as any,
        eventsRepository: {
          markEventDelivered: d.markEventDelivered,
          markEventFailedRetryable: d.markEventFailedRetryable,
          markEventPartiallyDelivered: d.markEventPartiallyDelivered,
          markEventCancelled: d.markEventCancelled
        } as any,
        deliveriesRepository: {
          createDelivery: d.createDelivery,
          markDeliverySending: d.markDeliverySending,
          markDeliveryProviderAccepted: d.markDeliveryProviderAccepted,
          markDeliveryFailedRetryable: d.markDeliveryFailedRetryable
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserId: d.sendPushToExternalUserId } as any,
        driverEligibilityService: {
          resolveDriversByIds: d.resolveDriversByIds,
          resolveEligibleDrivers: vi.fn(),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: d.resolveActiveExternalUserIds,
          getLatestLegFinancial: vi.fn(async () => ({ driverPayoutPence: 1000, currency: 'GBP' }))
        } as any,
        db: db as any
      }
    );

    expect(db.rpc).toHaveBeenCalledWith('job_leg_is_offerable', { p_booking_leg_id: 'leg-1' });
    expect(d.markEventCancelled).toHaveBeenCalledWith('evt-acc', 'job_not_offerable');
    expect(d.sendPushToExternalUserId).not.toHaveBeenCalled();
    expect(d.createDelivery).not.toHaveBeenCalled();
  });

  it('skips send when event is already cancelled', async () => {
    const d = baseDeps();
    const db = mockDb();

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-c',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          status: 'cancelled',
          driver_id: 'd1',
          payload: { job_id: 'leg-1', booking_type: 'oneway' }
        } as any,
        eventsRepository: {
          markEventDelivered: d.markEventDelivered,
          markEventFailedRetryable: d.markEventFailedRetryable,
          markEventPartiallyDelivered: d.markEventPartiallyDelivered,
          markEventCancelled: d.markEventCancelled
        } as any,
        deliveriesRepository: {
          createDelivery: d.createDelivery,
          markDeliverySending: d.markDeliverySending,
          markDeliveryProviderAccepted: d.markDeliveryProviderAccepted,
          markDeliveryFailedRetryable: d.markDeliveryFailedRetryable
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserId: d.sendPushToExternalUserId } as any,
        driverEligibilityService: {
          resolveDriversByIds: d.resolveDriversByIds,
          resolveEligibleDrivers: vi.fn(),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: d.resolveActiveExternalUserIds,
          getLatestLegFinancial: vi.fn(async () => ({ driverPayoutPence: 1000, currency: 'GBP' }))
        } as any,
        db: db as any
      }
    );

    expect(db.rpc).not.toHaveBeenCalled();
    expect(d.sendPushToExternalUserId).not.toHaveBeenCalled();
  });

  it('blocks provider send while status=processing if job no longer offerable', async () => {
    const d = baseDeps();
    const db = mockDb(vi.fn(async () => ({ data: false, error: null })));

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-proc',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          status: 'processing',
          driver_id: 'd1',
          payload: {
            job_id: 'leg-2',
            booking_type: 'oneway',
            dispatch_wave: 'premium'
          }
        } as any,
        eventsRepository: {
          markEventDelivered: d.markEventDelivered,
          markEventFailedRetryable: d.markEventFailedRetryable,
          markEventPartiallyDelivered: d.markEventPartiallyDelivered,
          markEventCancelled: d.markEventCancelled
        } as any,
        deliveriesRepository: {
          createDelivery: d.createDelivery,
          markDeliverySending: d.markDeliverySending,
          markDeliveryProviderAccepted: d.markDeliveryProviderAccepted,
          markDeliveryFailedRetryable: d.markDeliveryFailedRetryable
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserId: d.sendPushToExternalUserId } as any,
        driverEligibilityService: {
          resolveDriversByIds: d.resolveDriversByIds,
          resolveEligibleDrivers: vi.fn(),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: d.resolveActiveExternalUserIds,
          getLatestLegFinancial: vi.fn(async () => ({ driverPayoutPence: 1000, currency: 'GBP' }))
        } as any,
        db: db as any
      }
    );

    expect(d.markEventCancelled).toHaveBeenCalledWith('evt-proc', 'job_not_offerable');
    expect(d.sendPushToExternalUserId).not.toHaveBeenCalled();
  });

  it('sends with fake provider when offerable=true on retryable event', async () => {
    const d = baseDeps();
    const db = mockDb(vi.fn(async () => ({ data: true, error: null })));

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-ok',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          status: 'failed_retryable',
          driver_id: 'd9',
          payload: {
            job_id: 'leg-9',
            booking_reference: 'CB-9',
            booking_type: 'oneway',
            dispatch_wave: 'direct',
            push_title: 'Job reserved for you',
            push_message: 'Retry'
          }
        } as any,
        eventsRepository: {
          markEventDelivered: d.markEventDelivered,
          markEventFailedRetryable: d.markEventFailedRetryable,
          markEventPartiallyDelivered: d.markEventPartiallyDelivered,
          markEventCancelled: d.markEventCancelled
        } as any,
        deliveriesRepository: {
          createDelivery: d.createDelivery,
          markDeliverySending: d.markDeliverySending,
          markDeliveryProviderAccepted: d.markDeliveryProviderAccepted,
          markDeliveryFailedRetryable: d.markDeliveryFailedRetryable
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserId: d.sendPushToExternalUserId } as any,
        driverEligibilityService: {
          resolveDriversByIds: d.resolveDriversByIds,
          resolveEligibleDrivers: vi.fn(),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: d.resolveActiveExternalUserIds,
          getLatestLegFinancial: vi.fn(async () => ({ driverPayoutPence: 1000, currency: 'GBP' }))
        } as any,
        db: db as any
      }
    );

    expect(d.sendPushToExternalUserId).toHaveBeenCalledTimes(1);
    expect(d.markEventDelivered).toHaveBeenCalledWith('evt-ok');
    expect(d.markEventCancelled).not.toHaveBeenCalled();
  });
});

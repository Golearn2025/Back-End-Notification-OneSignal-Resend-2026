import { describe, expect, it, vi } from 'vitest';
import { processDriverJobAvailable } from '../../src/modules/notifications/handlers/process-driver-job-available.handler.js';

/**
 * Late offerability gate: re-check immediately before OneSignal.
 * Residual race (HTTP already in flight) is documented in migrations/20261114_006 notes —
 * once the request left the process, accept/cancel cannot recall it.
 */

describe('late offerability gate before OneSignal', () => {
  it('stops pending deliveries when job becomes non-offerable after fan-out prep', async () => {
    const markEventCancelled = vi.fn();
    const markDeliveryFailedFinal = vi.fn();
    const sendPushToExternalUserIds = vi.fn();

    let rpcCalls = 0;
    const rpc = vi.fn(async () => {
      rpcCalls += 1;
      // Early gate: offerable; late gate: accepted/cancelled meanwhile.
      return { data: rpcCalls === 1, error: null };
    });

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-late',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          source_module: 'dispatch',
          priority: 'high',
          status: 'processing',
          customer_id: null,
          driver_id: 'd1',
          payload: {
            job_id: 'leg-late',
            booking_reference: 'CB-LATE',
            booking_type: 'oneway',
            dispatch_wave: 'direct',
            push_title: 'Job',
            push_message: 'Body'
          }
        } as any,
        eventsRepository: {
          markEventDelivered: vi.fn(),
          markEventFailedRetryable: vi.fn(),
          markEventPartiallyDelivered: vi.fn(),
          markEventCancelled,
          markEventDeadLetter: vi.fn()
        } as any,
        deliveriesRepository: {
          createDelivery: vi.fn(async (input: any) => ({
            id: `del-${input.recipient_id}`,
            status: 'queued',
            ...input
          })),
          markDeliverySending: vi.fn(),
          markDeliveryProviderAccepted: vi.fn(),
          markDeliveryFailedRetryable: vi.fn(),
          markDeliveryFailedFinal
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserIds } as any,
        driverEligibilityService: {
          resolveEligibleDrivers: vi.fn(),
          resolveDriversByIds: vi.fn(async ({ driverIds }: { driverIds: string[] }) =>
            driverIds.map((id) => ({ driverId: id, authUserId: `auth-${id}` }))
          ),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: vi.fn(async ({ authUserIds }: { authUserIds: string[] }) =>
            new Set(authUserIds)
          ),
          getLatestLegFinancial: vi.fn()
        } as any,
        db: { rpc } as any
      }
    );

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(sendPushToExternalUserIds).not.toHaveBeenCalled();
    expect(markDeliveryFailedFinal).toHaveBeenCalledWith(
      'del-d1',
      'job_not_offerable_before_provider_send'
    );
    expect(markEventCancelled).toHaveBeenCalledWith(
      'evt-late',
      'job_not_offerable_before_provider_send'
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { processDriverJobAvailable } from '../../src/modules/notifications/handlers/process-driver-job-available.handler.js';

describe('processDriverJobAvailable targeting', () => {
  it('notifies only event.driver_id when set (Direct / Premium target)', async () => {
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

    const resolveEligibleDrivers = vi.fn(async () => [
      { driverId: 'd1', authUserId: 'a1' },
      { driverId: 'd2', authUserId: 'a2' },
      { driverId: 'd3', authUserId: 'a3' }
    ]);
    const resolveDriversByIds = vi.fn(async ({ driverIds }: { driverIds: string[] }) =>
      driverIds.map((id) => ({ driverId: id, authUserId: `auth-${id}` }))
    );
    const resolvePremiumDriverIds = vi.fn(async () => new Set(['d2']));
    const resolveActiveExternalUserIds = vi.fn(async ({ authUserIds }: { authUserIds: string[] }) =>
      new Set(authUserIds)
    );

    const sendPushToExternalUserIds = vi.fn(async ({ externalUserIds }: { externalUserIds: string[] }) => ({
      providerMessageId: `msg-${externalUserIds.join(',')}`,
      responseMetadata: { invalidExternalIds: [] }
    }));

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-1',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          source_module: 'dispatch_payment_succeeded',
          priority: 'high',
          status: 'processing',
          customer_id: null,
          driver_id: 'd2',
          payload: {
            booking_reference: 'CB-TEST',
            booking_type: 'oneway',
            dispatch_wave: 'direct',
            push_title: 'Job reserved for you',
            push_message: 'Test'
          }
        } as any,
        eventsRepository: {
          markEventDelivered,
          markEventFailedRetryable,
          markEventPartiallyDelivered,
          markEventCancelled
        } as any,
        deliveriesRepository: {
          createDelivery,
          markDeliverySending,
          markDeliveryProviderAccepted,
          markDeliveryFailedRetryable,
          markDeliveryFailedFinal: vi.fn()
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserIds } as any,
        driverEligibilityService: {
          resolveEligibleDrivers,
          resolveDriversByIds,
          resolvePremiumDriverIds,
          resolveActiveExternalUserIds,
          getLatestLegFinancial: vi.fn()
        } as any,
        db: { rpc: vi.fn() } as any
      }
    );

    expect(resolveDriversByIds).toHaveBeenCalledWith({
      organizationId: 'org-1',
      driverIds: ['d2']
    });
    expect(resolveEligibleDrivers).not.toHaveBeenCalled();
    expect(sendPushToExternalUserIds).toHaveBeenCalledTimes(1);
    expect(sendPushToExternalUserIds).toHaveBeenCalledWith(
      expect.objectContaining({ externalUserIds: ['auth-d2'] })
    );
    expect(createDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_id: 'd2',
        recipient_selection: 'assigned_driver',
        recipient_type: 'driver'
      })
    );
    expect(markEventDelivered).toHaveBeenCalledWith('evt-1');
  });

  it('sends open-wave recipients in one OneSignal request with explicit list', async () => {
    const markEventDelivered = vi.fn();
    const createDelivery = vi.fn(async (input: any) => ({
      id: `del-${input.recipient_id}`,
      status: 'queued',
      ...input
    }));
    const markDeliveryProviderAccepted = vi.fn();

    const resolveEligibleDrivers = vi.fn(async () => [
      { driverId: 'd1', authUserId: 'a1' },
      { driverId: 'd2', authUserId: 'a2' }
    ]);
    const resolveDriversByIds = vi.fn();
    const resolvePremiumDriverIds = vi.fn();
    const resolveActiveExternalUserIds = vi.fn(async ({ authUserIds }: { authUserIds: string[] }) =>
      new Set(authUserIds)
    );
    const sendPushToExternalUserIds = vi.fn(async () => ({
      providerMessageId: 'msg-bulk',
      responseMetadata: { invalidExternalIds: [] }
    }));

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-2',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          source_module: 'dispatch_wave_open',
          priority: 'high',
          status: 'processing',
          customer_id: null,
          driver_id: null,
          payload: {
            booking_reference: 'CB-OPEN',
            booking_type: 'oneway',
            dispatch_wave: 'open',
            push_title: 'New job available',
            push_message: 'Test open'
          }
        } as any,
        eventsRepository: {
          markEventDelivered,
          markEventFailedRetryable: vi.fn(),
          markEventPartiallyDelivered: vi.fn(),
          markEventCancelled: vi.fn()
        } as any,
        deliveriesRepository: {
          createDelivery,
          markDeliverySending: vi.fn(),
          markDeliveryProviderAccepted,
          markDeliveryFailedRetryable: vi.fn(),
          markDeliveryFailedFinal: vi.fn()
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserIds } as any,
        driverEligibilityService: {
          resolveEligibleDrivers,
          resolveDriversByIds,
          resolvePremiumDriverIds,
          resolveActiveExternalUserIds,
          getLatestLegFinancial: vi.fn()
        } as any,
        db: { rpc: vi.fn() } as any
      }
    );

    expect(resolveEligibleDrivers).toHaveBeenCalled();
    expect(resolveDriversByIds).not.toHaveBeenCalled();
    expect(sendPushToExternalUserIds).toHaveBeenCalledTimes(1);
    expect(sendPushToExternalUserIds).toHaveBeenCalledWith(
      expect.objectContaining({ externalUserIds: ['a1', 'a2'] })
    );
    expect(markDeliveryProviderAccepted).toHaveBeenCalledTimes(2);
    expect(markEventDelivered).toHaveBeenCalledWith('evt-2');
  });

  it('cancels send when job is no longer offerable', async () => {
    const markEventCancelled = vi.fn();
    const sendPushToExternalUserIds = vi.fn();

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-3',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          source_module: 'dispatch',
          priority: 'high',
          status: 'processing',
          customer_id: null,
          driver_id: null,
          payload: {
            job_id: 'leg-1',
            booking_reference: 'CB-X',
            booking_type: 'oneway'
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
          createDelivery: vi.fn(),
          markDeliverySending: vi.fn(),
          markDeliveryProviderAccepted: vi.fn(),
          markDeliveryFailedRetryable: vi.fn(),
          markDeliveryFailedFinal: vi.fn()
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserIds } as any,
        driverEligibilityService: {
          resolveEligibleDrivers: vi.fn(),
          resolveDriversByIds: vi.fn(),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: vi.fn(),
          getLatestLegFinancial: vi.fn()
        } as any,
        db: {
          rpc: vi.fn(async () => ({ data: false, error: null })),
          from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: null, error: null }))
          }))
        } as any
      }
    );

    expect(markEventCancelled).toHaveBeenCalledWith('evt-3', 'job_not_offerable');
    expect(sendPushToExternalUserIds).not.toHaveBeenCalled();
  });
});

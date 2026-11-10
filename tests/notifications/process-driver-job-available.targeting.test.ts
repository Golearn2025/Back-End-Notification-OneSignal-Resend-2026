import { describe, expect, it, vi } from 'vitest';
import { processDriverJobAvailable } from '../../src/modules/notifications/handlers/process-driver-job-available.handler.js';

describe('processDriverJobAvailable targeting', () => {
  it('notifies only event.driver_id when set (Direct / Premium target)', async () => {
    const markEventDelivered = vi.fn();
    const markEventFailedRetryable = vi.fn();
    const markEventPartiallyDelivered = vi.fn();
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

    const sendPushToExternalUserId = vi.fn(async ({ externalUserId }: { externalUserId: string }) => ({
      providerMessageId: `msg-${externalUserId}`,
      responseMetadata: {}
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
          markEventPartiallyDelivered
        } as any,
        deliveriesRepository: {
          createDelivery,
          markDeliverySending,
          markDeliveryProviderAccepted,
          markDeliveryFailedRetryable
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserId } as any,
        driverEligibilityService: {
          resolveEligibleDrivers,
          resolveDriversByIds,
          resolvePremiumDriverIds,
          resolveActiveExternalUserIds,
          getLatestLegFinancial: vi.fn()
        } as any,
        db: {} as any
      }
    );

    expect(resolveDriversByIds).toHaveBeenCalledWith({
      organizationId: 'org-1',
      driverIds: ['d2']
    });
    expect(resolveEligibleDrivers).not.toHaveBeenCalled();
    expect(sendPushToExternalUserId).toHaveBeenCalledTimes(1);
    expect(sendPushToExternalUserId).toHaveBeenCalledWith(
      expect.objectContaining({ externalUserId: 'auth-d2' })
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

  it('keeps broadcast for open wave without driver_id', async () => {
    const markEventDelivered = vi.fn();
    const createDelivery = vi.fn(async (input: any) => ({
      id: `del-${input.recipient_id}`,
      status: 'queued',
      ...input
    }));

    const resolveEligibleDrivers = vi.fn(async () => [
      { driverId: 'd1', authUserId: 'a1' },
      { driverId: 'd2', authUserId: 'a2' }
    ]);
    const resolveDriversByIds = vi.fn();
    const resolvePremiumDriverIds = vi.fn();
    const resolveActiveExternalUserIds = vi.fn(async ({ authUserIds }: { authUserIds: string[] }) =>
      new Set(authUserIds)
    );
    const sendPushToExternalUserId = vi.fn(async ({ externalUserId }: { externalUserId: string }) => ({
      providerMessageId: `msg-${externalUserId}`,
      responseMetadata: {}
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
          markEventPartiallyDelivered: vi.fn()
        } as any,
        deliveriesRepository: {
          createDelivery,
          markDeliverySending: vi.fn(),
          markDeliveryProviderAccepted: vi.fn(),
          markDeliveryFailedRetryable: vi.fn()
        } as any
      },
      {
        oneSignal: { sendPushToExternalUserId } as any,
        driverEligibilityService: {
          resolveEligibleDrivers,
          resolveDriversByIds,
          resolvePremiumDriverIds,
          resolveActiveExternalUserIds,
          getLatestLegFinancial: vi.fn()
        } as any,
        db: {} as any
      }
    );

    expect(resolveEligibleDrivers).toHaveBeenCalled();
    expect(resolveDriversByIds).not.toHaveBeenCalled();
    expect(sendPushToExternalUserId).toHaveBeenCalledTimes(2);
    expect(markEventDelivered).toHaveBeenCalledWith('evt-2');
  });
});

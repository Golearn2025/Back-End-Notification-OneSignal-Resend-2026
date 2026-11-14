import { describe, expect, it, vi } from 'vitest';
import { processDriverJobAvailable } from '../../src/modules/notifications/handlers/process-driver-job-available.handler.js';
import { processAdminDriverNotificationBatch } from '../../src/modules/notifications/handlers/process-admin-driver-notification-batch.js';

describe('provider accepted but DB persist fails', () => {
  it('marks job deliveries retryable with idempotency key (partial bulk)', async () => {
    const markDeliveryProviderAccepted = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db write failed'));
    const markDeliveryFailedRetryable = vi.fn();
    const markEventPartiallyDelivered = vi.fn();

    const sendPushToExternalUserIds = vi.fn(async () => ({
      providerMessageId: 'os-accepted',
      idempotencyKey: 'vl-push:evt-persist:fixed',
      responseMetadata: { invalidExternalIds: [] }
    }));

    await processDriverJobAvailable(
      {
        event: {
          id: 'evt-persist',
          organization_id: 'org-1',
          event_type: 'driver_job_available',
          source_module: 'dispatch_wave_open',
          priority: 'high',
          status: 'processing',
          customer_id: null,
          driver_id: null,
          payload: {
            booking_reference: 'CB-P',
            booking_type: 'oneway',
            dispatch_wave: 'open',
            push_title: 'New job',
            push_message: 'Open wave'
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
        oneSignal: { sendPushToExternalUserIds } as any,
        driverEligibilityService: {
          resolveEligibleDrivers: vi.fn(async () => [
            { driverId: 'd1', authUserId: 'a1' },
            { driverId: 'd2', authUserId: 'a2' }
          ]),
          resolveDriversByIds: vi.fn(),
          resolvePremiumDriverIds: vi.fn(),
          resolveActiveExternalUserIds: vi.fn(async ({ authUserIds }: { authUserIds: string[] }) =>
            new Set(authUserIds)
          ),
          getLatestLegFinancial: vi.fn()
        } as any,
        db: { rpc: vi.fn() } as any
      }
    );

    expect(sendPushToExternalUserIds).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: expect.stringContaining('vl-push:evt-persist:') })
    );
    expect(markDeliveryFailedRetryable).toHaveBeenCalledWith(
      'del-d2',
      expect.stringContaining('provider_accepted_db_persist_failed'),
      expect.any(String)
    );
    expect(markDeliveryFailedRetryable.mock.calls[0]?.[1]).toContain('idempotency=');
    expect(markEventPartiallyDelivered).toHaveBeenCalledWith('evt-persist');
  });

  it('admin bulk: partial DB persist failure keeps idempotency for retry', async () => {
    const markDeliveryProviderAccepted = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('row lock timeout'));
    const markDeliveryFailedRetryable = vi.fn();
    const markEventFailedRetryable = vi.fn();
    const markEventDelivered = vi.fn();

    const sendPushToExternalUserIds = vi.fn(async () => ({
      providerMessageId: 'os-admin',
      idempotencyKey: 'vl-push:admin-bulk:e1,e2:abc',
      responseMetadata: { invalidExternalIds: [] }
    }));

    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { auth_user_id: 'auth-1' }, error: null })
      .mockResolvedValueOnce({ data: { auth_user_id: 'auth-2' }, error: null });

    const baseEvent = {
      organization_id: 'org-1',
      event_type: 'admin_driver_system',
      source_module: 'admin_communications',
      priority: 'normal',
      status: 'processing',
      customer_id: null,
      payload: {
        push_title: 'Campaign',
        push_body: 'Hello'
      }
    };

    await processAdminDriverNotificationBatch({
      events: [
        { ...baseEvent, id: 'e1', driver_id: 'd1' } as any,
        { ...baseEvent, id: 'e2', driver_id: 'd2' } as any
      ],
      eventsRepository: {
        markEventDelivered,
        markEventFailedRetryable,
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
      } as any,
      oneSignal: { sendPushToExternalUserIds } as any,
      db: {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle
        }))
      } as any
    });

    expect(markEventDelivered).toHaveBeenCalledWith('e1');
    expect(markEventFailedRetryable).toHaveBeenCalledWith(
      'e2',
      expect.stringContaining('provider_accepted_db_persist_failed'),
      expect.any(String)
    );
    expect(markDeliveryFailedRetryable).toHaveBeenCalledWith(
      'del-d2',
      expect.stringMatching(/idempotency=.*provider_message_id=os-admin/),
      expect.any(String)
    );
    expect(sendPushToExternalUserIds).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: expect.stringContaining('vl-push:') })
    );
  });
});

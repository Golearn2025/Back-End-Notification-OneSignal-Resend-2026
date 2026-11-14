import { describe, expect, it, vi } from 'vitest';
import { processAdminDriverNotificationBatch } from '../../src/modules/notifications/handlers/process-admin-driver-notification-batch.js';

describe('processAdminDriverNotificationBatch', () => {
  it('sends shared-content admin events as one OneSignal request', async () => {
    const markEventDelivered = vi.fn();
    const markEventFailedRetryable = vi.fn();
    const createDelivery = vi.fn(async (input: any) => ({
      id: `del-${input.recipient_id}`,
      status: 'queued',
      ...input
    }));
    const markDeliverySending = vi.fn();
    const markDeliveryProviderAccepted = vi.fn();
    const sendPushToExternalUserIds = vi.fn(async () => ({
      providerMessageId: 'bulk-1',
      responseMetadata: { invalidExternalIds: [] }
    }));

    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { auth_user_id: 'auth-1' }, error: null })
      .mockResolvedValueOnce({ data: { auth_user_id: 'auth-2' }, error: null });

    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle
      }))
    };

    const baseEvent = {
      organization_id: 'org-1',
      event_type: 'admin_driver_system',
      source_module: 'admin_communications',
      priority: 'normal',
      status: 'processing',
      customer_id: null,
      payload: {
        push_title: 'Test Notifications',
        push_body: 'Confirma in grup daca ai primit Notificare'
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
        createDelivery,
        markDeliverySending,
        markDeliveryProviderAccepted,
        markDeliveryFailedRetryable: vi.fn(),
        markDeliveryFailedFinal: vi.fn()
      } as any,
      oneSignal: { sendPushToExternalUserIds } as any,
      db: db as any
    });

    expect(sendPushToExternalUserIds).toHaveBeenCalledTimes(1);
    expect(sendPushToExternalUserIds).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserIds: ['auth-1', 'auth-2'],
        title: 'Test Notifications'
      })
    );
    expect(markDeliveryProviderAccepted).toHaveBeenCalledTimes(2);
    expect(markEventDelivered).toHaveBeenCalledTimes(2);
  });
});

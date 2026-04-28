import { describe, expect, it, vi } from 'vitest';
import { NotificationDeliveriesRepository } from '../../src/modules/notifications/notification-deliveries.repository.js';

describe('NotificationDeliveriesRepository', () => {
  it('maps createDelivery input to notification_deliveries insert payload', async () => {
    const insertSpy = vi.fn();
    const fakeDb = {
      from: vi.fn(() => ({
        insert: vi.fn((payload: unknown) => {
          insertSpy(payload);
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'del-1', status: 'queued' },
                error: null
              })
            })
          };
        })
      }))
    };

    const repo = new NotificationDeliveriesRepository(fakeDb as never);
    await repo.createDelivery({
      organization_id: 'org-1',
      event_id: 'evt-1',
      recipient_type: 'customer',
      recipient_selection: 'specific_customer',
      recipient_id: 'cus-1',
      recipient_address: 'customer@example.com',
      channel: 'email',
      provider: 'resend'
    });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        event_id: 'evt-1',
        recipient_type: 'customer',
        recipient_selection: 'specific_customer',
        channel: 'email',
        provider: 'resend'
      })
    );
  });
});

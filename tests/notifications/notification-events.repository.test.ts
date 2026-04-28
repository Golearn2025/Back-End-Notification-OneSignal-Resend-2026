import { describe, expect, it, vi } from 'vitest';
import { NotificationEventsRepository } from '../../src/modules/notifications/notification-events.repository.js';

describe('NotificationEventsRepository', () => {
  it('maps createEvent input to notification_events insert payload', async () => {
    const insertSpy = vi.fn();
    const fakeDb = {
      from: vi.fn(() => ({
        insert: vi.fn((payload: unknown) => {
          insertSpy(payload);
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'evt-1', event_type: 'customer_account_created' },
                error: null
              })
            })
          };
        })
      }))
    };

    const repo = new NotificationEventsRepository(fakeDb as never);
    await repo.createEvent({
      organization_id: 'org-1',
      event_type: 'customer_account_created',
      source_module: 'identity',
      idempotency_key: 'k1',
      customer_id: 'cus-1',
      payload: { customer_email: 'customer@example.com' }
    });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        event_type: 'customer_account_created',
        source_module: 'identity',
        idempotency_key: 'k1',
        customer_id: 'cus-1'
      })
    );
  });

  it('queries only retry-eligible pending events', async () => {
    const orSpy = vi.fn();
    const limitSpy = vi.fn(async () => ({ data: [], error: null }));
    const fakeDb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          or: vi.fn((expression: string) => {
            orSpy(expression);
            return {
              order: vi.fn(() => ({
                limit: limitSpy
              }))
            };
          })
        }))
      }))
    };

    const repo = new NotificationEventsRepository(fakeDb as never);
    await repo.getPendingEvents(10);

    expect(orSpy).toHaveBeenCalledTimes(1);
    expect(orSpy.mock.calls[0]?.[0]).toContain('status.in.(pending,ready)');
    expect(orSpy.mock.calls[0]?.[0]).toContain('status.eq.failed_retryable');
    expect(orSpy.mock.calls[0]?.[0]).toContain('next_retry_at.is.null');
    expect(orSpy.mock.calls[0]?.[0]).toContain('next_retry_at.lte.');
    expect(limitSpy).toHaveBeenCalledWith(10);
  });
});

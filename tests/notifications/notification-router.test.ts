import { describe, expect, it } from 'vitest';
import { NotificationRouterService } from '../../src/modules/notifications/notification-router.service.js';

describe('NotificationRouterService', () => {
  it('routes driver events to push and in-app', () => {
    const router = new NotificationRouterService();

    const channels = router.route({
      id: 'evt-1',
      organization_id: 'org-1',
      event_type: 'driver_job_available',
      source_module: 'dispatch',
      priority: 'normal',
      status: 'pending',
      customer_id: null,
      driver_id: 'drv-1',
      payload: {}
    });

    expect(channels).toEqual(['push', 'in_app']);
  });
});

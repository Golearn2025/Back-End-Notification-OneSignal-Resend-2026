import type { NotificationChannel, NotificationEvent } from './notification.types.js';

export class NotificationRouterService {
  // TODO: Use preferences/devices/inbox rules to pick channels.
  route(event: NotificationEvent): NotificationChannel[] {
    if (event.driver_id) {
      return ['push', 'in_app'];
    }

    return ['in_app'];
  }
}

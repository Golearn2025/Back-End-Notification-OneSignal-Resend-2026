import type { NotificationChannel, NotificationEvent } from './notification.types.js';

export class NotificationDispatcherService {
  // TODO: Connect channels to providers in future phases.
  async dispatch(_event: NotificationEvent, _channels: NotificationChannel[]): Promise<void> {
    return;
  }
}

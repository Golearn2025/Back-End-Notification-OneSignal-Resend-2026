import type { ICustomerAccountCreatedEmailSender } from '../../providers/resend.provider.js';
import type { NotificationEvent } from '../notification.types.js';
import { NotificationDeliveriesRepository } from '../notification-deliveries.repository.js';
import { NotificationEventsRepository } from '../notification-events.repository.js';

export type HandlerDeps = {
  event: NotificationEvent;
  eventsRepository: NotificationEventsRepository;
  deliveriesRepository: NotificationDeliveriesRepository;
  resend: ICustomerAccountCreatedEmailSender;
};

import { logger } from '../../config/logger.js';
import type { ICustomerAccountCreatedEmailSender } from '../providers/resend.provider.js';
import { ResendProvider } from '../providers/resend.provider.js';
import type { NotificationEvent } from './notification.types.js';
import { NotificationDeliveriesRepository } from './notification-deliveries.repository.js';
import { NotificationEventsRepository } from './notification-events.repository.js';
import { nextRetryAtIso } from './notification-shared.js';
import { processBookingPaymentConfirmed } from './handlers/process-booking-payment-confirmed.handler.js';
import { processCustomerAccountCreated } from './handlers/process-customer-account-created.handler.js';
import { processDriverJobAvailable } from './handlers/process-driver-job-available.handler.js';

export class NotificationProcessorService {
  constructor(
    private readonly eventsRepository = new NotificationEventsRepository(),
    private readonly deliveriesRepository = new NotificationDeliveriesRepository(),
    private readonly resend: ICustomerAccountCreatedEmailSender = new ResendProvider()
  ) {}

  async process(event: NotificationEvent): Promise<void> {
    logger.info(
      {
        eventId: event.id,
        eventType: event.event_type,
        organizationId: event.organization_id
      },
      'Processing notification event'
    );

    if (event.event_type === 'customer_account_created') {
      await processCustomerAccountCreated({
        event,
        eventsRepository: this.eventsRepository,
        deliveriesRepository: this.deliveriesRepository,
        resend: this.resend
      });
      return;
    }

    if (event.event_type === 'booking_payment_confirmed') {
      await processBookingPaymentConfirmed({
        event,
        eventsRepository: this.eventsRepository,
        deliveriesRepository: this.deliveriesRepository,
        resend: this.resend
      });
      return;
    }

    if (event.event_type === 'driver_job_available') {
      await processDriverJobAvailable({
        event,
        eventsRepository: this.eventsRepository,
        deliveriesRepository: this.deliveriesRepository
      });
      return;
    }

    const reason = `Unsupported event_type: ${event.event_type}`;
    await this.eventsRepository.markEventFailedRetryable(event.id, reason, nextRetryAtIso());

    logger.warn(
      {
        eventId: event.id,
        eventType: event.event_type,
        organizationId: event.organization_id,
        status: 'failed_retryable'
      },
      'Notification event marked as failed_retryable'
    );
  }
}

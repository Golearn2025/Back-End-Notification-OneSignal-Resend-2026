import { logger } from '../../config/logger.js';
import { getEnv } from '../../config/env.js';
import type { ICustomerAccountCreatedEmailSender } from '../providers/resend.provider.js';
import { ResendProvider } from '../providers/resend.provider.js';
import type { NotificationEvent } from './notification.types.js';
import { NotificationDeliveriesRepository } from './notification-deliveries.repository.js';
import { NotificationEventsRepository } from './notification-events.repository.js';

const RETRY_MS = 5 * 60 * 1000;
const DEFAULT_WEBSITE_URL = 'https://vantage-lane.com';
const DEFAULT_SUPPORT_EMAIL = 'info@vantage-lane.com';
const DEFAULT_SUPPORT_PHONE = '+44 20 4620 3131';
const RESEND_TEMPLATE_ID = 'c27ab80b-22ef-4249-a5d1-f78ed1d72f8d';
const RESEND_TEMPLATE_ALIAS = 'customer_account_created_v1';
const PAYMENT_TEMPLATE_ALIAS = 'payment_success_customer_v1';

function nextRetryAtIso(): string {
  return new Date(Date.now() + RETRY_MS).toISOString();
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatCreatedDate(event: NotificationEvent): string {
  const source = asNonEmptyString(event.occurred_at) ?? asNonEmptyString(event.created_at);
  if (!source) {
    return new Date().toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: '2-digit'
    });
  }
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    return source;
  }
  return parsed.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: '2-digit'
  });
}

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
      await this.processCustomerAccountCreated(event);
      return;
    }

    if (event.event_type === 'booking_payment_confirmed') {
      await this.processBookingPaymentConfirmed(event);
      return;
    }

    {
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
      return;
    }
  }

  private async processCustomerAccountCreated(event: NotificationEvent): Promise<void> {
    const customerEmail = this.extractCustomerEmail(event);
    const customerFirstName = asNonEmptyString(event.payload.customer_first_name) ?? 'there';
    const env = getEnv();
    const websiteUrl = env.PUBLIC_WEBSITE_URL ?? DEFAULT_WEBSITE_URL;
    const supportEmail = DEFAULT_SUPPORT_EMAIL;
    const supportPhone = DEFAULT_SUPPORT_PHONE;
    const createdDate = formatCreatedDate(event);

    const delivery = await this.deliveriesRepository.createDelivery({
      organization_id: event.organization_id,
      event_id: event.id,
      recipient_type: 'customer',
      recipient_selection: 'specific_customer',
      recipient_id: event.customer_id,
      recipient_address: customerEmail,
      channel: 'email',
      provider: 'resend',
      status: 'queued',
      max_attempts: 3,
      metadata: {
        template_id: RESEND_TEMPLATE_ID,
        template_alias: RESEND_TEMPLATE_ALIAS,
        template_version: 'v1',
        render_mode: 'resend_template',
        reply_to: DEFAULT_SUPPORT_EMAIL
      }
    });

    await this.deliveriesRepository.markDeliverySending(delivery.id);

    try {
      const { providerMessageId } = await this.resend.sendCustomerAccountCreatedEmail({
        to: customerEmail,
        customerFirstName,
        createdDate,
        websiteUrl,
        supportEmail,
        supportPhone
      });

      await this.deliveriesRepository.markDeliveryProviderAccepted(delivery.id, providerMessageId, {
        provider: 'resend',
        event_type: 'customer_account_created',
        template_id: RESEND_TEMPLATE_ID,
        template_alias: RESEND_TEMPLATE_ALIAS,
        template_version: 'v1',
        render_mode: 'resend_template',
        reply_to: DEFAULT_SUPPORT_EMAIL
      });
      await this.eventsRepository.markEventDelivered(event.id);

      logger.info(
        {
          eventId: event.id,
          eventType: event.event_type,
          organizationId: event.organization_id,
          status: 'delivered'
        },
        'Notification event delivered via Resend'
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Resend send failed';
      const retryAt = nextRetryAtIso();
      await this.deliveriesRepository.markDeliveryFailedRetryable(delivery.id, reason, retryAt);
      await this.eventsRepository.markEventFailedRetryable(event.id, reason, retryAt);

      logger.warn(
        {
          eventId: event.id,
          eventType: event.event_type,
          organizationId: event.organization_id,
          status: 'failed_retryable'
        },
        'customer_account_created email failed; marked for retry'
      );
    }
  }

  private async processBookingPaymentConfirmed(event: NotificationEvent): Promise<void> {
    const customerEmail = this.extractCustomerEmail(event);
    const customerFirstName = asNonEmptyString(event.payload.customer_first_name) ?? 'there';
    const invoiceNumber = asNonEmptyString(event.payload.invoice_number) ?? 'Pending';
    const paymentDate = asNonEmptyString(event.payload.payment_date) ?? formatCreatedDate(event);
    const paymentMethod = asNonEmptyString(event.payload.payment_method);
    const amountPaid = asNonEmptyString(event.payload.amount_paid);
    const currency = asNonEmptyString(event.payload.currency);
    const receiptUrl = asNonEmptyString(event.payload.receipt_url);
    const bookingLine1Label = asNonEmptyString(event.payload.booking_line_1_label) ?? 'Booking';
    const bookingLine1Value = asNonEmptyString(event.payload.booking_line_1_value) ?? 'Confirmed';
    const bookingLine2Label = asNonEmptyString(event.payload.booking_line_2_label) ?? '';
    const bookingLine2Value = asNonEmptyString(event.payload.booking_line_2_value) ?? '';
    const bookingLine3Label = asNonEmptyString(event.payload.booking_line_3_label) ?? '';
    const bookingLine3Value = asNonEmptyString(event.payload.booking_line_3_value) ?? '';
    const bookingLine4Label = asNonEmptyString(event.payload.booking_line_4_label) ?? '';
    const bookingLine4Value = asNonEmptyString(event.payload.booking_line_4_value) ?? '';
    const bookingLine5Label = asNonEmptyString(event.payload.booking_line_5_label) ?? '';
    const bookingLine5Value = asNonEmptyString(event.payload.booking_line_5_value) ?? '';
    const bookingLine6Label = asNonEmptyString(event.payload.booking_line_6_label) ?? '';
    const bookingLine6Value = asNonEmptyString(event.payload.booking_line_6_value) ?? '';
    const supportEmail = asNonEmptyString(event.payload.support_email) ?? DEFAULT_SUPPORT_EMAIL;
    const supportPhone = asNonEmptyString(event.payload.support_phone) ?? DEFAULT_SUPPORT_PHONE;

    const delivery = await this.deliveriesRepository.createDelivery({
      organization_id: event.organization_id,
      event_id: event.id,
      recipient_type: 'customer',
      recipient_selection: 'specific_customer',
      recipient_id: event.customer_id,
      recipient_address: customerEmail,
      channel: 'email',
      provider: 'resend',
      status: 'queued',
      max_attempts: 3,
      metadata: {
        template_alias: PAYMENT_TEMPLATE_ALIAS,
        template_version: 'v1',
        render_mode: 'resend_template',
        reply_to: DEFAULT_SUPPORT_EMAIL,
        event_family: 'payment',
        includes_booking_summary: true,
        context_source:
          asNonEmptyString(event.payload.context_source) ?? 'app_notification_payment_success_context'
      }
    });

    await this.deliveriesRepository.markDeliverySending(delivery.id);

    try {
      if (!paymentMethod) {
        throw new Error('Missing required payload.payment_method for booking_payment_confirmed');
      }
      if (!amountPaid) {
        throw new Error('Missing required payload.amount_paid for booking_payment_confirmed');
      }
      if (!currency) {
        throw new Error('Missing required payload.currency for booking_payment_confirmed');
      }
      if (!receiptUrl) {
        throw new Error('Missing required payload.receipt_url for booking_payment_confirmed');
      }

      const { providerMessageId } = await this.resend.sendBookingPaymentConfirmedEmail({
        to: customerEmail,
        customerFirstName,
        invoiceNumber,
        paymentDate,
        paymentMethod,
        amountPaid,
        currency,
        receiptUrl,
        bookingLine1Label,
        bookingLine1Value,
        bookingLine2Label,
        bookingLine2Value,
        bookingLine3Label,
        bookingLine3Value,
        bookingLine4Label,
        bookingLine4Value,
        bookingLine5Label,
        bookingLine5Value,
        bookingLine6Label,
        bookingLine6Value,
        supportEmail,
        supportPhone
      });

      await this.deliveriesRepository.markDeliveryProviderAccepted(delivery.id, providerMessageId, {
        provider: 'resend',
        event_type: 'booking_payment_confirmed',
        template_alias: PAYMENT_TEMPLATE_ALIAS,
        template_version: 'v1',
        render_mode: 'resend_template',
        reply_to: DEFAULT_SUPPORT_EMAIL,
        event_family: 'payment',
        includes_booking_summary: true,
        context_source:
          asNonEmptyString(event.payload.context_source) ?? 'app_notification_payment_success_context'
      });
      await this.eventsRepository.markEventDelivered(event.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Resend payment template send failed';
      const retryAt = nextRetryAtIso();
      await this.deliveriesRepository.markDeliveryFailedRetryable(delivery.id, reason, retryAt);
      await this.eventsRepository.markEventFailedRetryable(event.id, reason, retryAt);
    }
  }

  private extractCustomerEmail(event: NotificationEvent): string {
    const email = event.payload.customer_email;
    if (typeof email !== 'string' || email.length === 0) {
      throw new Error(`Missing payload.customer_email for event ${event.id}`);
    }

    return email;
  }
}

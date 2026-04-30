import { getEnv } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_WEBSITE_URL,
  RESEND_TEMPLATE_ALIAS,
  RESEND_TEMPLATE_ID,
  asNonEmptyString,
  formatCreatedDate,
  nextRetryAtIso
} from '../notification-shared.js';
import type { HandlerDeps } from './handler-deps.js';

export async function processCustomerAccountCreated({
  event,
  eventsRepository,
  deliveriesRepository,
  resend
}: HandlerDeps): Promise<void> {
  const customerEmail = extractCustomerEmail(event);
  const customerFirstName = asNonEmptyString(event.payload.customer_first_name) ?? 'there';
  const env = getEnv();
  const websiteUrl = env.PUBLIC_WEBSITE_URL ?? DEFAULT_WEBSITE_URL;
  const supportEmail = DEFAULT_SUPPORT_EMAIL;
  const supportPhone = DEFAULT_SUPPORT_PHONE;
  const createdDate = formatCreatedDate(event);

  const delivery = await deliveriesRepository.createDelivery({
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

  await deliveriesRepository.markDeliverySending(delivery.id);

  try {
    const { providerMessageId } = await resend.sendCustomerAccountCreatedEmail({
      to: customerEmail,
      customerFirstName,
      createdDate,
      websiteUrl,
      supportEmail,
      supportPhone
    });

    await deliveriesRepository.markDeliveryProviderAccepted(delivery.id, providerMessageId, {
      provider: 'resend',
      event_type: 'customer_account_created',
      template_id: RESEND_TEMPLATE_ID,
      template_alias: RESEND_TEMPLATE_ALIAS,
      template_version: 'v1',
      render_mode: 'resend_template',
      reply_to: DEFAULT_SUPPORT_EMAIL
    });
    await eventsRepository.markEventDelivered(event.id);

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
    await deliveriesRepository.markDeliveryFailedRetryable(delivery.id, reason, retryAt);
    await eventsRepository.markEventFailedRetryable(event.id, reason, retryAt);

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

function extractCustomerEmail(event: HandlerDeps['event']): string {
  const email = event.payload.customer_email;
  if (typeof email !== 'string' || email.length === 0) {
    throw new Error(`Missing payload.customer_email for event ${event.id}`);
  }

  return email;
}

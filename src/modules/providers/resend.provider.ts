import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  buildDriverJobAcceptedTemplateSend,
  type SendDriverJobAcceptedEmailInput
} from './resend/driver-job-accepted.template.js';
import {
  buildDriverDocumentExpiringTemplateSend,
  type SendDriverDocumentExpiringEmailInput
} from './resend/driver-document-expiring.template.js';
import {
  buildPaymentSuccessCustomerTemplateSend,
  type SendBookingPaymentConfirmedEmailInput
} from './resend/payment-success-customer.template.js';
import {
  buildCustomerAccountCreatedTemplateSend,
  type SendCustomerAccountCreatedEmailInput
} from './resend/customer-account-created.template.js';
import type { SendResendTemplateInput } from './resend/send-template.types.js';

export type { SendCustomerAccountCreatedEmailInput };
export type { SendBookingPaymentConfirmedEmailInput };

export type SendJobsMailboxBookingConfirmedEmailInput = {
  to: string;
  bookingReference: unknown;
  customerFirstName: unknown;
  pickupLocation: unknown;
  dropoffLocation: unknown;
  pickupTime: unknown;
  vehicleClass: unknown;
  amountPaid: unknown;
  currency: unknown;
  adminBookingUrl: unknown;
};

export type SendCustomerAccountCreatedEmailResult = {
  providerMessageId: string;
};

export type { SendResendTemplateInput } from './resend/send-template.types.js';
export type { SendDriverJobAcceptedEmailInput } from './resend/driver-job-accepted.template.js';
export type { SendDriverDocumentExpiringEmailInput } from './resend/driver-document-expiring.template.js';

function escapeTemplateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let raw = '';
  if (typeof value === 'string') {
    raw = value;
  } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    raw = String(value);
  } else if (value instanceof Date) {
    raw = value.toISOString();
  } else {
    return '';
  }

  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .trim();
}

/**
 * Resend (https://resend.com) transactional email. Does not log API key or full HTML.
 */
export class ResendProvider implements ICustomerAccountCreatedEmailSender {
  async sendTemplateEmail(input: SendResendTemplateInput): Promise<SendCustomerAccountCreatedEmailResult> {
    const env = getEnv();
    const apiKey = env.RESEND_API_KEY;
    const from = env.RESEND_FROM_EMAIL;

    if (!apiKey || !from) {
      throw new Error('Resend not configured: RESEND_API_KEY and RESEND_FROM_EMAIL are required');
    }

    // Trusted HTML fragments built server-side (optional table rows / duty blocks).
    const passthroughHtmlKeys = new Set(['optional_summary_rows', 'flight_duty_block']);
    const sanitizedVariables = Object.fromEntries(
      Object.entries(input.variables).map(([key, value]) => [
        key,
        passthroughHtmlKeys.has(key)
          ? typeof value === 'string'
            ? value
            : ''
          : escapeTemplateValue(value)
      ])
    );

    const payload: Record<string, unknown> = {
      from,
      to: [input.to],
      subject: input.subject,
      reply_to: input.replyTo ? [input.replyTo] : undefined,
      tags: input.tags,
      template: {
        id: input.templateIdOrAlias,
        variables: sanitizedVariables
      }
    };
    if (input.attachments && input.attachments.length > 0) {
      payload.attachments = input.attachments.map((file) => ({
        filename: file.filename,
        content: file.content,
        content_type: file.contentType
      }));
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const body = (await response.json()) as {
      data?: { id: string };
      id?: string;
      message?: string;
    };

    const messageId = body.data?.id ?? body.id;
    if (!response.ok || !messageId) {
      logger.warn(
        { statusCode: response.status, provider: 'resend' },
        'Resend template send failed'
      );
      throw new Error(
        `Resend send failed: status=${response.status} message=${body.message ?? 'unknown'}`
      );
    }

    logger.info({ provider: 'resend' }, 'Resend accepted template email');
    return { providerMessageId: messageId };
  }

  async sendCustomerAccountCreatedEmail(
    input: SendCustomerAccountCreatedEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult> {
    return this.sendTemplateEmail(buildCustomerAccountCreatedTemplateSend(input));
  }

  async sendBookingPaymentConfirmedEmail(
    input: SendBookingPaymentConfirmedEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult> {
    return this.sendTemplateEmail(buildPaymentSuccessCustomerTemplateSend(input));
  }

  async sendJobsMailboxBookingConfirmedEmail(
    input: SendJobsMailboxBookingConfirmedEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult> {
    return this.sendTemplateEmail({
      to: input.to,
      templateIdOrAlias: 'jobs_mailbox_booking_confirmed_v1',
      subject: `New Booking Alert - ${String(input.bookingReference ?? '')}`.trim(),
      replyTo: 'newjobs@vantage-lane.com',
      tags: [{ name: 'event_type', value: 'booking_payment_confirmed_admin' }],
      variables: {
        booking_reference: input.bookingReference,
        customer_first_name: input.customerFirstName,
        pickup_location: input.pickupLocation,
        dropoff_location: input.dropoffLocation,
        pickup_time: input.pickupTime,
        vehicle_class: input.vehicleClass,
        amount_paid: input.amountPaid,
        currency: input.currency,
        admin_booking_url: input.adminBookingUrl
      }
    });
  }

  async sendDriverJobAcceptedEmail(
    input: SendDriverJobAcceptedEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult> {
    return this.sendTemplateEmail(buildDriverJobAcceptedTemplateSend(input));
  }

  async sendDriverDocumentExpiringEmail(
    input: SendDriverDocumentExpiringEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult> {
    return this.sendTemplateEmail(buildDriverDocumentExpiringTemplateSend(input));
  }
}

/**
 * For dependency injection in tests.
 */
export type ICustomerAccountCreatedEmailSender = {
  sendCustomerAccountCreatedEmail(
    input: SendCustomerAccountCreatedEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult>;
  sendBookingPaymentConfirmedEmail(
    input: SendBookingPaymentConfirmedEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult>;
  sendJobsMailboxBookingConfirmedEmail(
    input: SendJobsMailboxBookingConfirmedEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult>;
  sendDriverJobAcceptedEmail(
    input: SendDriverJobAcceptedEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult>;
  sendDriverDocumentExpiringEmail(
    input: SendDriverDocumentExpiringEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult>;
};

import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export type SendCustomerAccountCreatedEmailInput = {
  to: string;
  customerFirstName: unknown;
  createdDate: unknown;
  websiteUrl: unknown;
  supportEmail: unknown;
  supportPhone: unknown;
};

export type SendBookingPaymentConfirmedEmailInput = {
  to: string;
  customerFirstName: unknown;
  invoiceNumber: unknown;
  paymentDate: unknown;
  paymentMethod: unknown;
  amountPaid: unknown;
  currency: unknown;
  receiptUrl: unknown;
  bookingLine1Label: unknown;
  bookingLine1Value: unknown;
  bookingLine2Label: unknown;
  bookingLine2Value: unknown;
  bookingLine3Label: unknown;
  bookingLine3Value: unknown;
  bookingLine4Label: unknown;
  bookingLine4Value: unknown;
  bookingLine5Label: unknown;
  bookingLine5Value: unknown;
  bookingLine6Label: unknown;
  bookingLine6Value: unknown;
  supportEmail: unknown;
  supportPhone: unknown;
};

export type SendCustomerAccountCreatedEmailResult = {
  providerMessageId: string;
};

export type SendResendTemplateInput = {
  to: string;
  templateIdOrAlias: string;
  variables: Record<string, unknown>;
  subject?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
};

function escapeTemplateValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
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

    const sanitizedVariables = Object.fromEntries(
      Object.entries(input.variables).map(([key, value]) => [key, escapeTemplateValue(value)])
    );

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        reply_to: input.replyTo ? [input.replyTo] : undefined,
        tags: input.tags,
        template: {
          id: input.templateIdOrAlias,
          variables: sanitizedVariables
        }
      })
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
    return this.sendTemplateEmail({
      to: input.to,
      templateIdOrAlias: 'customer_account_created_v1',
      subject: 'Welcome to Vantage Lane',
      replyTo: 'info@vantage-lane.com',
      tags: [{ name: 'event_type', value: 'customer_account_created' }],
      variables: {
        customer_first_name: input.customerFirstName,
        created_date: input.createdDate,
        website_url: input.websiteUrl,
        support_email: input.supportEmail,
        support_phone: input.supportPhone
      }
    });
  }

  async sendBookingPaymentConfirmedEmail(
    input: SendBookingPaymentConfirmedEmailInput
  ): Promise<SendCustomerAccountCreatedEmailResult> {
    return this.sendTemplateEmail({
      to: input.to,
      templateIdOrAlias: 'payment_success_customer_v1',
      subject: 'Payment received for your Vantage Lane booking',
      replyTo: 'info@vantage-lane.com',
      tags: [{ name: 'event_type', value: 'booking_payment_confirmed' }],
      variables: {
        customer_first_name: input.customerFirstName,
        invoice_number: input.invoiceNumber,
        payment_date: input.paymentDate,
        payment_method: input.paymentMethod,
        amount_paid: input.amountPaid,
        currency: input.currency,
        receipt_url: input.receiptUrl,
        booking_line_1_label: input.bookingLine1Label,
        booking_line_1_value: input.bookingLine1Value,
        booking_line_2_label: input.bookingLine2Label,
        booking_line_2_value: input.bookingLine2Value,
        booking_line_3_label: input.bookingLine3Label,
        booking_line_3_value: input.bookingLine3Value,
        booking_line_4_label: input.bookingLine4Label,
        booking_line_4_value: input.bookingLine4Value,
        booking_line_5_label: input.bookingLine5Label,
        booking_line_5_value: input.bookingLine5Value,
        booking_line_6_label: input.bookingLine6Label,
        booking_line_6_value: input.bookingLine6Value,
        support_email: input.supportEmail,
        support_phone: input.supportPhone
      }
    });
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
};

import { getEnv } from '../../../config/env.js';
import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_WEBSITE_URL,
  JOBS_MAILBOX_ADDRESS,
  JOBS_MAILBOX_TEMPLATE_ALIAS,
  PAYMENT_TEMPLATE_ALIAS,
  asNonEmptyString,
  formatCreatedDate,
  getBookingLineValue,
  nextRetryAtIso
} from '../notification-shared.js';
import type { HandlerDeps } from './handler-deps.js';

export async function processBookingPaymentConfirmed({
  event,
  eventsRepository,
  deliveriesRepository,
  resend
}: HandlerDeps): Promise<void> {
  const customerEmail = extractCustomerEmail(event);
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
  const bookingReference =
    asNonEmptyString(event.payload.booking_reference) ??
    getBookingLineValue(event.payload, 'Reference') ??
    'Pending';
  const pickupLocation =
    asNonEmptyString(event.payload.pickup_location) ??
    asNonEmptyString(event.payload.route_from) ??
    getBookingLineValue(event.payload, 'Pickup') ??
    '-';
  const dropoffLocation =
    asNonEmptyString(event.payload.dropoff_location) ??
    asNonEmptyString(event.payload.route_to) ??
    getBookingLineValue(event.payload, 'Dropoff') ??
    '-';
  const pickupTime =
    asNonEmptyString(event.payload.pickup_time) ??
    getBookingLineValue(event.payload, 'Pickup Time') ??
    getBookingLineValue(event.payload, 'When') ??
    paymentDate;
  const vehicleClass =
    asNonEmptyString(event.payload.vehicle_class) ??
    getBookingLineValue(event.payload, 'Vehicle') ??
    '-';
  const adminBookingUrl =
    asNonEmptyString(event.payload.admin_booking_url) ??
    asNonEmptyString(event.payload.receipt_url) ??
    getEnv().PUBLIC_WEBSITE_URL ??
    DEFAULT_WEBSITE_URL;

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

  await deliveriesRepository.markDeliverySending(delivery.id);

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

    const { providerMessageId } = await resend.sendBookingPaymentConfirmedEmail({
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

    await deliveriesRepository.markDeliveryProviderAccepted(delivery.id, providerMessageId, {
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

    const adminDelivery = await deliveriesRepository.createDelivery({
      organization_id: event.organization_id,
      event_id: event.id,
      recipient_type: 'jobs_mailbox',
      recipient_selection: 'fixed_mailbox',
      recipient_id: null,
      recipient_address: JOBS_MAILBOX_ADDRESS,
      channel: 'email',
      provider: 'resend',
      status: 'queued',
      max_attempts: 3,
      metadata: {
        template_alias: JOBS_MAILBOX_TEMPLATE_ALIAS,
        template_version: 'v1',
        render_mode: 'resend_template',
        reply_to: JOBS_MAILBOX_ADDRESS,
        event_family: 'payment',
        mailbox: 'jobs'
      }
    });

    await deliveriesRepository.markDeliverySending(adminDelivery.id);
    try {
      const { providerMessageId: adminProviderMessageId } = await resend.sendJobsMailboxBookingConfirmedEmail({
        to: JOBS_MAILBOX_ADDRESS,
        bookingReference,
        customerFirstName,
        pickupLocation,
        dropoffLocation,
        pickupTime,
        vehicleClass,
        amountPaid,
        currency,
        adminBookingUrl
      });
      await deliveriesRepository.markDeliveryProviderAccepted(adminDelivery.id, adminProviderMessageId, {
        provider: 'resend',
        event_type: 'booking_payment_confirmed_admin',
        template_alias: JOBS_MAILBOX_TEMPLATE_ALIAS,
        template_version: 'v1',
        render_mode: 'resend_template',
        reply_to: JOBS_MAILBOX_ADDRESS,
        event_family: 'payment',
        mailbox: 'jobs'
      });
    } catch (adminError) {
      const adminReason = adminError instanceof Error ? adminError.message : 'Resend jobs mailbox send failed';
      await deliveriesRepository.markDeliveryFailedRetryable(adminDelivery.id, adminReason, nextRetryAtIso());
    }

    await eventsRepository.markEventDelivered(event.id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Resend payment template send failed';
    const retryAt = nextRetryAtIso();
    await deliveriesRepository.markDeliveryFailedRetryable(delivery.id, reason, retryAt);
    await eventsRepository.markEventFailedRetryable(event.id, reason, retryAt);
  }
}

function extractCustomerEmail(event: HandlerDeps['event']): string {
  const email = event.payload.customer_email;
  if (typeof email !== 'string' || email.length === 0) {
    throw new Error(`Missing payload.customer_email for event ${event.id}`);
  }

  return email;
}

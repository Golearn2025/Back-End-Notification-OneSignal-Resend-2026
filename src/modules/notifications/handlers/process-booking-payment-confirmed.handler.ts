import { getEnv } from '../../../config/env.js';
import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_WHATSAPP,
  DEFAULT_WEBSITE_URL,
  JOBS_MAILBOX_ADDRESS,
  JOBS_MAILBOX_TEMPLATE_ALIAS,
  PAYMENT_TEMPLATE_ALIAS,
  asNonEmptyString,
  formatCreatedDate,
  getBookingLineValue,
  isDeliverySucceeded,
  nextRetryAtIso
} from '../notification-shared.js';
import type { HandlerDeps } from './handler-deps.js';

function bookingTypeLabel(raw: string | null | undefined): string {
  const t = (raw ?? '').toLowerCase();
  if (t === 'oneway') return 'One Way';
  if (t === 'return') return 'Return';
  if (t === 'hourly') return 'Hourly';
  if (t === 'daily') return 'Daily';
  if (t === 'fleet') return 'Fleet';
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Booking';
}

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
  const receiptUrl =
    asNonEmptyString(event.payload.receipt_url) ??
    getEnv().PUBLIC_WEBSITE_URL ??
    DEFAULT_WEBSITE_URL;
  const supportEmail = asNonEmptyString(event.payload.support_email) ?? DEFAULT_SUPPORT_EMAIL;
  const supportPhone = asNonEmptyString(event.payload.support_phone) ?? DEFAULT_SUPPORT_PHONE;
  const supportWhatsapp =
    asNonEmptyString(event.payload.support_whatsapp) ?? DEFAULT_SUPPORT_WHATSAPP;
  const bookingReference =
    asNonEmptyString(event.payload.booking_reference) ??
    getBookingLineValue(event.payload, 'Reference') ??
    'Pending';
  const bookingTypeLabelValue =
    asNonEmptyString(event.payload.booking_type_label) ??
    bookingTypeLabel(asNonEmptyString(event.payload.booking_type));
  const pickupAddress =
    asNonEmptyString(event.payload.pickup_address) ??
    asNonEmptyString(event.payload.pickup_location) ??
    asNonEmptyString(event.payload.route_from) ??
    getBookingLineValue(event.payload, 'Pickup') ??
    '—';
  const dropoffAddress =
    asNonEmptyString(event.payload.dropoff_address) ??
    asNonEmptyString(event.payload.dropoff_location) ??
    asNonEmptyString(event.payload.route_to) ??
    getBookingLineValue(event.payload, 'Drop-off') ??
    getBookingLineValue(event.payload, 'Dropoff') ??
    '—';
  const pickupTime =
    asNonEmptyString(event.payload.pickup_time) ??
    getBookingLineValue(event.payload, 'Pickup time') ??
    getBookingLineValue(event.payload, 'Pickup Time') ??
    getBookingLineValue(event.payload, 'When') ??
    paymentDate;
  const flightNumber = asNonEmptyString(event.payload.flight_number) ?? '';
  const categoryLabel =
    asNonEmptyString(event.payload.category_label) ??
    asNonEmptyString(event.payload.vehicle_category_label) ??
    '—';
  const vehicleLabel =
    asNonEmptyString(event.payload.vehicle_label) ??
    asNonEmptyString(event.payload.vehicle_model_label) ??
    asNonEmptyString(event.payload.vehicle_class) ??
    getBookingLineValue(event.payload, 'Vehicle') ??
    '—';
  const passengersLuggage =
    asNonEmptyString(event.payload.passengers_luggage) ??
    (() => {
      const pax = event.payload.passenger_count;
      const bags = event.payload.bag_count;
      if (typeof pax === 'number' || typeof bags === 'number') {
        return `${typeof pax === 'number' ? pax : 0} / ${typeof bags === 'number' ? bags : 0}`;
      }
      return getBookingLineValue(event.payload, 'Passengers/Luggage') ?? '—';
    })();

  const pickupLocation = pickupAddress;
  const dropoffLocation = dropoffAddress;
  const vehicleClass = vehicleLabel;
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
      template_version: 'v2',
      render_mode: 'resend_template',
      reply_to: supportEmail,
      event_family: 'payment',
      includes_booking_summary: true,
      context_source:
        asNonEmptyString(event.payload.context_source) ?? 'app_notification_payment_success_context'
    }
  });

  if (isDeliverySucceeded(delivery.status)) {
    await eventsRepository.markEventDelivered(event.id);
    return;
  }

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

    const { providerMessageId } = await resend.sendBookingPaymentConfirmedEmail({
      to: customerEmail,
      customerFirstName,
      invoiceNumber,
      paymentDate,
      paymentMethod,
      amountPaid,
      currency,
      receiptUrl,
      bookingReference,
      bookingTypeLabel: bookingTypeLabelValue,
      pickupTime,
      pickupAddress,
      dropoffAddress,
      flightNumber,
      categoryLabel,
      vehicleLabel,
      passengersLuggage,
      supportEmail,
      supportPhone,
      supportWhatsapp
    });

    await deliveriesRepository.markDeliveryProviderAccepted(delivery.id, providerMessageId, {
      provider: 'resend',
      event_type: 'booking_payment_confirmed',
      template_alias: PAYMENT_TEMPLATE_ALIAS,
      template_version: 'v2',
      render_mode: 'resend_template',
      reply_to: supportEmail,
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

    if (!isDeliverySucceeded(adminDelivery.status)) {
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

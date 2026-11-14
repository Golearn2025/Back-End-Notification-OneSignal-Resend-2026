import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_WHATSAPP, // +44 7376 188443
  DEFAULT_WEBSITE_URL,
  PAYMENT_TEMPLATE_ALIAS
} from '../../notifications/notification-shared.js';
import type { SendResendTemplateInput } from './send-template.types.js';

export type SendBookingPaymentConfirmedEmailInput = {
  to: string;
  customerFirstName: unknown;
  invoiceNumber: unknown;
  paymentDate: unknown;
  paymentMethod: unknown;
  amountPaid: unknown;
  currency: unknown;
  receiptUrl: unknown;
  bookingReference: unknown;
  bookingTypeLabel: unknown;
  pickupTime: unknown;
  pickupAddress: unknown;
  dropoffAddress: unknown;
  flightNumber: unknown;
  categoryLabel: unknown;
  vehicleLabel: unknown;
  passengersLuggage: unknown;
  supportEmail?: unknown;
  supportPhone?: unknown;
  supportWhatsapp?: unknown;
  /** Legacy booking_line_* kept for Resend vars already published */
  bookingLine1Label?: unknown;
  bookingLine1Value?: unknown;
  bookingLine2Label?: unknown;
  bookingLine2Value?: unknown;
  bookingLine3Label?: unknown;
  bookingLine3Value?: unknown;
  bookingLine4Label?: unknown;
  bookingLine4Value?: unknown;
  bookingLine5Label?: unknown;
  bookingLine5Value?: unknown;
  bookingLine6Label?: unknown;
  bookingLine6Value?: unknown;
};

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

/** Digits only for tel: / wa.me links (keeps leading country code). */
function digitsOnly(value: string): string {
  return value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}

function e164Digits(value: string): string {
  const raw = digitsOnly(value);
  return raw.startsWith('+') ? raw.slice(1) : raw;
}

export function buildPaymentSuccessCustomerTemplateSend(
  input: SendBookingPaymentConfirmedEmailInput
): SendResendTemplateInput {
  // Prefer explicit fields; fall back to legacy booking_line_* if an older caller is used.
  const ref =
    text(input.bookingReference) ||
    (text(input.bookingLine2Label).toLowerCase().includes('reference')
      ? text(input.bookingLine2Value)
      : '');
  const typeLabel = text(input.bookingTypeLabel) || text(input.bookingLine1Value, 'Booking');
  const when =
    text(input.pickupTime) ||
    text(input.bookingLine3Value) ||
    'Pending confirmation';
  const pickup =
    text(input.pickupAddress) ||
    text(input.bookingLine4Value) ||
    '—';
  const dropoff =
    text(input.dropoffAddress) ||
    text(input.bookingLine5Value) ||
    '—';
  const invoice = text(input.invoiceNumber, 'Pending');
  const hasInvoice = Boolean(invoice && invoice.toLowerCase() !== 'pending');
  const rawReceipt = text(input.receiptUrl);
  const receiptUrl = rawReceipt || DEFAULT_WEBSITE_URL;
  const hasReceipt = Boolean(rawReceipt) && !/vantage-lane\.com\/?$/i.test(rawReceipt);
  const flight = text(input.flightNumber) || (
    text(input.bookingLine6Label).toLowerCase().includes('flight')
      ? text(input.bookingLine6Value)
      : ''
  );
  const supportEmail = text(input.supportEmail, DEFAULT_SUPPORT_EMAIL);
  const supportPhone = text(input.supportPhone, DEFAULT_SUPPORT_PHONE);
  const supportWhatsapp = text(input.supportWhatsapp, DEFAULT_SUPPORT_WHATSAPP);
  const phoneHref = `tel:${digitsOnly(supportPhone)}`;
  const whatsappHref = `https://wa.me/${e164Digits(supportWhatsapp)}`;
  const emailHref = `mailto:${supportEmail}`;

  return {
    to: input.to,
    templateIdOrAlias: PAYMENT_TEMPLATE_ALIAS,
    subject: ref ? `Payment received — ${ref}` : 'Payment received for your Vantage Lane booking',
    replyTo: supportEmail,
    tags: [{ name: 'event_type', value: 'booking_payment_confirmed' }],
    variables: {
      customer_first_name: text(input.customerFirstName, 'there'),
      invoice_number: hasInvoice ? invoice : '—',
      invoice_label: hasInvoice ? 'Invoice Number' : 'Invoice',
      payment_date: text(input.paymentDate),
      payment_method: text(input.paymentMethod, 'Payment confirmed'),
      amount_paid: text(input.amountPaid),
      currency: text(input.currency, 'GBP'),
      receipt_url: receiptUrl,
      receipt_cta: hasReceipt ? 'Download Receipt' : 'Visit Vantage Lane',
      booking_reference: ref || '—',
      booking_type_label: typeLabel || 'Booking',
      pickup_time: when,
      pickup_address: pickup,
      dropoff_address: dropoff,
      flight_number: flight || '—',
      flight_row_label: 'Flight',
      category_label: text(input.categoryLabel, '—'),
      vehicle_label: text(input.vehicleLabel, '—'),
      passengers_luggage: text(input.passengersLuggage, '—'),
      support_email: supportEmail,
      support_phone: supportPhone,
      support_whatsapp: supportWhatsapp,
      support_email_href: emailHref,
      support_phone_href: phoneHref,
      support_whatsapp_href: whatsappHref
    }
  };
}

import {
  DEFAULT_SUPPORT_EMAIL,
  DRIVER_JOB_ACCEPTED_TEMPLATE_ALIAS
} from '../../notifications/notification-shared.js';
import type { SendResendTemplateInput } from './send-template.types.js';

export type SendDriverJobAcceptedEmailInput = {
  to: string;
  driverFirstName: unknown;
  bookingReference: unknown;
  pickupAddress: unknown;
  dropoffAddress: unknown;
  scheduledAt: unknown;
  passengerCount: unknown;
  bagCount: unknown;
  bookingType: unknown;
  vehicleCategoryId: unknown;
  vehicleModelId: unknown;
  /** Sumă numerică fără simbol (ex. 130.00), pentru template cu {{{driver_payout}}}. */
  driverPayoutPence: unknown;
  payoutCurrency: unknown;
  driverPayoutDisplay: unknown;
  supportEmail: unknown;
  supportPhone: unknown;
};

/**
 * Maps domain fields → Resend template variables + metadata.
 * Keeps ResendProvider thin; add new emails as sibling * .template.ts files.
 */
function payoutPartsFromPence(pence: unknown, currency: unknown): { amount: string; code: string } {
  const p = typeof pence === 'number' && !Number.isNaN(pence) ? pence : null;
  const codeRaw = typeof currency === 'string' && currency.trim().length > 0 ? currency.trim().toUpperCase() : 'GBP';
  if (p == null || p <= 0) {
    return { amount: '', code: codeRaw };
  }
  return { amount: (p / 100).toFixed(2), code: codeRaw };
}

export function buildDriverJobAcceptedTemplateSend(
  input: SendDriverJobAcceptedEmailInput
): SendResendTemplateInput {
  const ref = String(input.bookingReference ?? '').trim();
  const { amount: driverPayout, code: payoutCurrency } = payoutPartsFromPence(
    input.driverPayoutPence,
    input.payoutCurrency
  );
  return {
    to: input.to,
    templateIdOrAlias: DRIVER_JOB_ACCEPTED_TEMPLATE_ALIAS,
    subject: ref.length > 0 ? `Job confirmed — ${ref}` : 'Job confirmed — Vantage Lane',
    replyTo: DEFAULT_SUPPORT_EMAIL,
    tags: [{ name: 'event_type', value: 'driver_job_accepted' }],
    variables: {
      driver_first_name: input.driverFirstName,
      booking_reference: input.bookingReference,
      pickup_address: input.pickupAddress,
      dropoff_address: input.dropoffAddress,
      scheduled_at: input.scheduledAt,
      passenger_count: input.passengerCount,
      bag_count: input.bagCount,
      booking_type: input.bookingType,
      vehicle_category_id: input.vehicleCategoryId,
      vehicle_model_id: input.vehicleModelId,
      driver_payout: driverPayout,
      payout_currency: payoutCurrency,
      driver_payout_display: input.driverPayoutDisplay,
      support_email: input.supportEmail,
      support_phone: input.supportPhone
    }
  };
}

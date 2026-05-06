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
  legKind: unknown;
  legNumber: unknown;
  hoursRequested: unknown;
  daysRequested: unknown;
  fleetTotalLegs: unknown;
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

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildLegDisplay(legKind: unknown, legNumber: unknown): string {
  const kind = normalizeText(legKind);
  const number = normalizeNumber(legNumber);
  if (!kind && number == null) {
    return '-';
  }
  if (number == null) {
    return kind || '-';
  }
  return `${kind || 'leg'} ${number}`;
}

function buildDurationDisplay(bookingType: unknown, hoursRequested: unknown, daysRequested: unknown): string {
  const type = normalizeText(bookingType).toLowerCase();
  const hours = normalizeNumber(hoursRequested);
  const days = normalizeNumber(daysRequested);

  if (type === 'hourly') {
    return hours != null ? `${hours} h` : '-';
  }
  if (type === 'daily') {
    return days != null ? `${days} d` : '-';
  }

  const parts: string[] = [];
  if (hours != null) {
    parts.push(`${hours} h`);
  }
  if (days != null) {
    parts.push(`${days} d`);
  }
  return parts.length > 0 ? parts.join(' / ') : '-';
}

function buildFleetVehiclesDisplay(value: unknown): string {
  const n = normalizeNumber(value);
  return n != null && n > 0 ? String(n) : '-';
}

export function buildDriverJobAcceptedTemplateSend(
  input: SendDriverJobAcceptedEmailInput
): SendResendTemplateInput {
  const ref = String(input.bookingReference ?? '').trim();
  const { amount: driverPayout, code: payoutCurrency } = payoutPartsFromPence(
    input.driverPayoutPence,
    input.payoutCurrency
  );
  const legDisplay = buildLegDisplay(input.legKind, input.legNumber);
  const durationDisplay = buildDurationDisplay(
    input.bookingType,
    input.hoursRequested,
    input.daysRequested
  );
  const fleetVehiclesDisplay = buildFleetVehiclesDisplay(input.fleetTotalLegs);

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
      leg_kind: input.legKind,
      leg_number: input.legNumber,
      hours_requested: input.hoursRequested,
      days_requested: input.daysRequested,
      fleet_total_legs: input.fleetTotalLegs,
      leg_display: legDisplay,
      duration_display: durationDisplay,
      fleet_total_legs_display: fleetVehiclesDisplay,
      driver_payout: driverPayout,
      payout_currency: payoutCurrency,
      driver_payout_display: input.driverPayoutDisplay,
      support_email: input.supportEmail,
      support_phone: input.supportPhone
    }
  };
}

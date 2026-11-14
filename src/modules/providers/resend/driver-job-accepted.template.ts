import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_WHATSAPP,
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
  /** Flight number when present (airport pickup). */
  flightNumber?: unknown;
  /** Human-readable category · model. */
  vehicleLabel: unknown;
  vehicleCategoryId?: unknown;
  vehicleModelId?: unknown;
  legKind: unknown;
  legNumber: unknown;
  hoursRequested: unknown;
  daysRequested: unknown;
  fleetTotalLegs: unknown;
  driverPayoutPence: unknown;
  payoutCurrency: unknown;
  driverPayoutDisplay: unknown;
  supportEmail?: unknown;
  supportPhone?: unknown;
  supportWhatsapp?: unknown;
  /** Optional PDF welcome board (base64) attached by ResendProvider. */
  welcomeBoardPdfBase64?: string;
  welcomeBoardFilename?: string;
};

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

function normalizeText(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function digitsOnly(value: string): string {
  return value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}

function e164Digits(value: string): string {
  const raw = digitsOnly(value);
  return raw.startsWith('+') ? raw.slice(1) : raw;
}

function bookingTypeLabel(raw: unknown): string {
  const t = normalizeText(raw).toLowerCase();
  if (t === 'oneway' || t === 'one_way' || t === 'one-way') return 'One Way';
  if (t === 'return') return 'Return';
  if (t === 'hourly') return 'Hourly';
  if (t === 'daily') return 'Daily';
  if (t === 'fleet') return 'Fleet';
  if (!t) return 'Booking';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function bookingTypeKey(raw: unknown): string {
  return normalizeText(raw).toLowerCase().replace(/[_-]/g, '');
}

function buildLegLabel(
  bookingType: unknown,
  legKind: unknown,
  legNumber: unknown,
  fleetTotalLegs: unknown
): string {
  const type = bookingTypeKey(bookingType);
  const kind = normalizeText(legKind).toLowerCase();
  const number = normalizeNumber(legNumber);
  const fleetTotal = normalizeNumber(fleetTotalLegs);

  if (type === 'return') {
    if (kind.includes('return') || number === 2) return 'Return';
    if (kind.includes('out') || kind === 'main' || number === 1) return 'Outbound';
    if (number != null) return `Leg ${number}`;
    return '';
  }

  if (type === 'fleet') {
    if (number != null && fleetTotal != null && fleetTotal > 0) {
      return `Vehicle ${number} of ${fleetTotal}`;
    }
    if (number != null) return `Vehicle ${number}`;
    return '';
  }

  return '';
}

function buildDurationLabel(
  bookingType: unknown,
  hoursRequested: unknown,
  daysRequested: unknown
): string {
  const type = bookingTypeKey(bookingType);
  const hours = normalizeNumber(hoursRequested);
  const days = normalizeNumber(daysRequested);

  if (type === 'hourly') {
    if (hours == null) return '';
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  if (type === 'daily') {
    if (days == null) return '';
    return days === 1 ? '1 day' : `${days} days`;
  }
  return '';
}

function buildFleetVehiclesLabel(bookingType: unknown, fleetTotalLegs: unknown): string {
  if (bookingTypeKey(bookingType) !== 'fleet') return '';
  const n = normalizeNumber(fleetTotalLegs);
  if (n == null || n <= 0) return '';
  return n === 1 ? '1 vehicle' : `${n} vehicles`;
}

function passengersLuggage(passengerCount: unknown, bagCount: unknown): string {
  const pax = normalizeNumber(passengerCount);
  const bags = normalizeNumber(bagCount);
  if (pax == null && bags == null) return '—';
  return `${pax ?? 0} / ${bags ?? 0}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function summaryRowHtml(label: string, value: string, opts?: { strong?: boolean }): string {
  const valueStyle = opts?.strong
    ? 'padding:12px 18px;color:#1a1a1a;font-size:14px;text-align:right;font-weight:700;border-top:1px solid #f0e6d2;'
    : 'padding:12px 18px;color:#1a1a1a;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #f0e6d2;';
  return `<tr>
                          <td style="padding:12px 18px;color:#666;font-size:14px;border-top:1px solid #f0e6d2;">
                            ${escapeHtml(label)}
                          </td>
                          <td style="${valueStyle}">
                            ${escapeHtml(value)}
                          </td>
                        </tr>`;
}

function buildFlightDutyNote(flightNumber: string): string {
  if (!flightNumber) return '';
  return `It is your responsibility to monitor flight ${flightNumber} and follow its status through to landing. Be in the terminal arrivals hall, ready for meet & greet, when your guest lands — not afterwards. Your guest must never wait for you.`;
}

function buildFlightDutyBlockHtml(flightDutyNote: string): string {
  if (!flightDutyNote) return '';
  return `<tr>
              <td style="padding:18px 28px 0 28px;">
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  style="background:#1a1a1a;border-radius:12px;"
                >
                  <tr>
                    <td style="padding:18px 20px;">
                      <div
                        style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#c8a96a;margin-bottom:10px;"
                      >
                        Meet &amp; greet duty
                      </div>
                      <p style="margin:0;font-size:14px;line-height:1.65;color:#f4efe4;">
                        ${escapeHtml(flightDutyNote)}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

/**
 * Optional Job summary rows. Resend does not reliably support Mustache {{#sections}},
 * so we inject only the rows that apply for this booking type.
 * - Flight: from booking_legs.flight_number (not in driver_jobs_accepted_v1)
 * - Leg: return / fleet only
 * - Duration: hourly / daily only
 * - Fleet size: fleet only
 */
function buildOptionalSummaryRowsHtml(input: {
  flightNumber: string;
  legDisplay: string;
  durationDisplay: string;
  fleetSizeDisplay: string;
}): string {
  const rows: string[] = [];
  if (input.flightNumber) {
    rows.push(summaryRowHtml('Flight', input.flightNumber, { strong: true }));
  }
  if (input.legDisplay) {
    rows.push(summaryRowHtml('Leg', input.legDisplay));
  }
  if (input.durationDisplay) {
    rows.push(summaryRowHtml('Duration', input.durationDisplay));
  }
  if (input.fleetSizeDisplay) {
    rows.push(summaryRowHtml('Fleet size', input.fleetSizeDisplay));
  }
  return rows.join('\n');
}

export function buildDriverJobAcceptedTemplateSend(
  input: SendDriverJobAcceptedEmailInput
): SendResendTemplateInput {
  const ref = normalizeText(input.bookingReference);
  const { amount: driverPayout, code: payoutCurrency } = payoutPartsFromPence(
    input.driverPayoutPence,
    input.payoutCurrency
  );
  const typeLabel = bookingTypeLabel(input.bookingType);
  const flightNumber = normalizeText(input.flightNumber);
  const legDisplay = buildLegLabel(
    input.bookingType,
    input.legKind,
    input.legNumber,
    input.fleetTotalLegs
  );
  const durationDisplay = buildDurationLabel(
    input.bookingType,
    input.hoursRequested,
    input.daysRequested
  );
  const fleetSizeDisplay = buildFleetVehiclesLabel(input.bookingType, input.fleetTotalLegs);
  const supportEmail = normalizeText(input.supportEmail, DEFAULT_SUPPORT_EMAIL);
  const supportPhone = normalizeText(input.supportPhone, DEFAULT_SUPPORT_PHONE);
  const supportWhatsapp = normalizeText(input.supportWhatsapp, DEFAULT_SUPPORT_WHATSAPP);
  const vehicleLabel = normalizeText(input.vehicleLabel, '—');
  const payoutDisplay = normalizeText(input.driverPayoutDisplay, '—');
  const flightDutyNote = buildFlightDutyNote(flightNumber);
  const optionalSummaryRows = buildOptionalSummaryRowsHtml({
    flightNumber,
    legDisplay,
    durationDisplay,
    fleetSizeDisplay
  });
  const flightDutyBlock = buildFlightDutyBlockHtml(flightDutyNote);

  const attachments =
    input.welcomeBoardPdfBase64 && input.welcomeBoardFilename
      ? [
          {
            filename: input.welcomeBoardFilename,
            content: input.welcomeBoardPdfBase64,
            contentType: 'application/pdf'
          }
        ]
      : undefined;

  return {
    to: input.to,
    templateIdOrAlias: DRIVER_JOB_ACCEPTED_TEMPLATE_ALIAS,
    subject: ref.length > 0 ? `Job confirmed — ${ref}` : 'Job confirmed — Vantage Lane',
    replyTo: supportEmail,
    tags: [{ name: 'event_type', value: 'driver_job_accepted' }],
    attachments,
    variables: {
      driver_first_name: normalizeText(input.driverFirstName, 'there'),
      booking_reference: ref || '—',
      booking_type_label: typeLabel,
      pickup_address: normalizeText(input.pickupAddress, '—'),
      dropoff_address: normalizeText(input.dropoffAddress, '—'),
      scheduled_at: normalizeText(input.scheduledAt, '—'),
      passengers_luggage: passengersLuggage(input.passengerCount, input.bagCount),
      vehicle_label: vehicleLabel,
      optional_summary_rows: optionalSummaryRows,
      flight_duty_block: flightDutyBlock,
      // Kept for inventory / older drafts; primary render uses optional_summary_rows.
      flight_number: flightNumber,
      flight_duty_note: flightDutyNote,
      leg_display: legDisplay,
      duration_display: durationDisplay,
      fleet_size_display: fleetSizeDisplay,
      driver_payout: driverPayout,
      payout_currency: payoutCurrency,
      driver_payout_display: payoutDisplay,
      support_email: supportEmail,
      support_phone: supportPhone,
      support_whatsapp: supportWhatsapp,
      support_email_href: `mailto:${supportEmail}`,
      support_phone_href: `tel:${digitsOnly(supportPhone)}`,
      support_whatsapp_href: `https://wa.me/${e164Digits(supportWhatsapp)}`
    }
  };
}

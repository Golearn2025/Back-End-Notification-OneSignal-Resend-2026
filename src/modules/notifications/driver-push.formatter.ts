import { asNonEmptyString, formatDisplayToken } from './notification-shared.js';

export type DriverPushMessageInput = {
  bookingReference: string;
  bookingType: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  scheduledAt: string | null;
  vehicleCategoryId: string | null;
  vehicleModelId: string | null;
  payoutDisplay: string | null;
  payoutBreakdownLine?: string | null | undefined;
  distanceMiles?: number | string | null | undefined;
  durationMin?: number | null | undefined;
  stopsCount?: number | null | undefined;
  legKind?: string | null | undefined;
  legNumber?: number | null | undefined;
  hoursRequested?: number | null | undefined;
  daysRequested?: number | null | undefined;
  fleetTotalLegs?: number | null | undefined;
};

export function formatDriverPushDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London'
  });
}

function formatDriverPushDateTimeShort(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London'
  });
}

function formatLocationLine(address: string): string {
  const trimmed = address.trim();
  if (trimmed.includes('•')) {
    return trimmed;
  }
  const primary = trimmed.split(',')[0]?.trim() ?? '';
  return primary.length > 0 ? primary : trimmed;
}

/** Payout șofer rotunjit la liră întreagă — ca JobCard în app. */
export function formatDriverPayoutWholePence(pence: number | null, currency: string | null): string | null {
  if (typeof pence !== 'number' || Number.isNaN(pence) || pence <= 0) {
    return null;
  }
  const pounds = Math.round(pence / 100);
  const code = asNonEmptyString(currency)?.toUpperCase() ?? 'GBP';
  if (code === 'GBP') {
    return `£${pounds}`;
  }
  return `${code} ${pounds}`;
}

export function formatPayout(pence: number | null, currency: string | null): string | null {
  if (typeof pence !== 'number' || Number.isNaN(pence) || pence <= 0) {
    return null;
  }
  const amount = (pence / 100).toFixed(2);
  const code = asNonEmptyString(currency)?.toUpperCase() ?? 'GBP';
  if (code === 'GBP') {
    return `£${amount}`;
  }
  return `${code} ${amount}`;
}

function formatTripType(value: string | null): string | null {
  const displayBookingTypeRaw = formatDisplayToken(value);
  if (displayBookingTypeRaw?.toLowerCase() === 'oneway') {
    return 'One way';
  }
  return displayBookingTypeRaw;
}

function buildTripDetailLine(input: DriverPushMessageInput): string | null {
  const tripType = formatTripType(input.bookingType);
  const legLabel =
    input.legKind?.toLowerCase() === 'return'
      ? 'Return leg'
      : input.legNumber && input.legNumber > 1
        ? `Leg ${input.legNumber}`
        : null;

  if (!tripType && !legLabel) {
    return null;
  }
  if (tripType && legLabel) {
    return `${tripType} (${legLabel})`;
  }
  return tripType ?? legLabel;
}

function buildDurationLine(input: DriverPushMessageInput): string | null {
  if (input.bookingType === 'hourly' && input.hoursRequested && input.hoursRequested > 0) {
    return `Duration: ${input.hoursRequested} hour${input.hoursRequested > 1 ? 's' : ''}`;
  }
  if (input.bookingType === 'daily' && input.daysRequested && input.daysRequested > 0) {
    return `Duration: ${input.daysRequested} day${input.daysRequested > 1 ? 's' : ''}`;
  }
  if (input.bookingType === 'fleet' && input.fleetTotalLegs && input.fleetTotalLegs > 1) {
    return `Fleet dispatch: ${input.fleetTotalLegs} vehicles`;
  }
  return null;
}

function parseDistanceMiles(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function buildMetricsLine(input: DriverPushMessageInput): string | null {
  const miles = parseDistanceMiles(input.distanceMiles);
  const duration =
    typeof input.durationMin === 'number' && Number.isFinite(input.durationMin) && input.durationMin > 0
      ? input.durationMin
      : null;
  const stops =
    typeof input.stopsCount === 'number' && Number.isFinite(input.stopsCount) && input.stopsCount >= 0
      ? input.stopsCount
      : null;

  if (miles == null && duration == null && stops == null) {
    return null;
  }

  const parts: string[] = [];
  if (miles != null) {
    const miLabel = Number.isInteger(miles) ? String(miles) : miles.toFixed(2).replace(/\.?0+$/, '');
    parts.push(`${miLabel} mi`);
  }
  if (duration != null) {
    parts.push(`${duration} min`);
  }
  if (stops != null) {
    parts.push(`${stops} stop${stops === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

export function buildDriverPushMessage(input: DriverPushMessageInput): { title: string; message: string } {
  const displayCategory = formatDisplayToken(input.vehicleCategoryId);
  const displayModel = formatDisplayToken(input.vehicleModelId);
  const tripLine = buildTripDetailLine(input);
  const durationLine = buildDurationLine(input);
  const metricsLine = buildMetricsLine(input);
  const titleWhen = formatDriverPushDateTimeShort(input.scheduledAt);
  const pickupLine = input.pickupAddress ? formatLocationLine(input.pickupAddress) : null;
  const dropoffLine = input.dropoffAddress ? formatLocationLine(input.dropoffAddress) : null;

  const headerLine = tripLine
    ? `${input.bookingReference} · ${tripLine}`
    : input.bookingReference;

  const defaultTitleParts = ['New job'];
  if (input.payoutDisplay) {
    defaultTitleParts.push(input.payoutDisplay);
  }
  if (titleWhen) {
    defaultTitleParts.push(titleWhen);
  }

  const formattedSections = [
    headerLine,
    pickupLine ? `🟢 ${pickupLine}` : null,
    dropoffLine ? `🔴 ${dropoffLine}` : null,
    metricsLine,
    input.payoutBreakdownLine,
    durationLine,
    displayCategory || displayModel
      ? `${[displayCategory, displayModel].filter((token) => token).join(' · ')}`
      : null
  ].filter((value): value is string => value !== null);

  return {
    title: defaultTitleParts.join(' • '),
    message:
      formattedSections.length > 0
        ? formattedSections.join('\n')
        : `New ${input.bookingReference} job available`
  };
}

/** Push după ce șoferul a acceptat jobul (același corp ca „new job”, titlu „Job confirmed”). */
export function buildDriverJobAcceptedPushMessage(input: DriverPushMessageInput): { title: string; message: string } {
  const { message } = buildDriverPushMessage(input);
  const payoutPart = input.payoutDisplay ? ` • ${input.payoutDisplay}` : '';
  return {
    title: `Job confirmed • ${input.bookingReference}${payoutPart}`,
    message
  };
}

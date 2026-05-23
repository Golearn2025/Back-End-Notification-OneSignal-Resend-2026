import { asNonEmptyString, formatDisplayToken } from './notification-shared.js';

export type JobUrgency = 'ASAP' | 'Pre-Book';

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
  passengerCount?: number | null | undefined;
  bagCount?: number | null | undefined;
  urgency?: JobUrgency | null | undefined;
  returnScheduledAt?: string | null | undefined;
  legKind?: string | null | undefined;
  legNumber?: number | null | undefined;
  hoursRequested?: number | null | undefined;
  daysRequested?: number | null | undefined;
  fleetTotalLegs?: number | null | undefined;
};

/** Același display ca JobCard: (pence / 100).toFixed(0) */
export function formatPenceLikeJobCard(pence: number): string {
  return (pence / 100).toFixed(0);
}

export function formatDriverPayoutWholePence(pence: number | null, currency: string | null): string | null {
  if (typeof pence !== 'number' || Number.isNaN(pence) || pence <= 0) {
    return null;
  }
  const pounds = formatPenceLikeJobCard(pence);
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

/** Match determineJobType din driver app (60 min). */
export function determineJobUrgency(scheduledAt: string | null): JobUrgency | null {
  if (!scheduledAt) {
    return null;
  }
  const parsed = new Date(scheduledAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const diffMinutes = (parsed.getTime() - Date.now()) / (1000 * 60);
  return diffMinutes <= 60 ? 'ASAP' : 'Pre-Book';
}

/** Match formatDateTime din JobCard. */
export function formatJobCardDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const time = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Europe/London'
  });

  if (date.toDateString() === today.toDateString()) {
    return `Today, ${time}`;
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return `Tomorrow, ${time}`;
  }
  const dateStr = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London'
  });
  return `${dateStr}, ${time}`;
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

function formatTripType(value: string | null): string | null {
  const displayBookingTypeRaw = formatDisplayToken(value);
  if (displayBookingTypeRaw?.toLowerCase() === 'oneway') {
    return 'One way';
  }
  return displayBookingTypeRaw;
}

function buildHeaderLine(input: DriverPushMessageInput): string {
  const tripType = formatTripType(input.bookingType);
  const parts = [tripType, input.urgency].filter((token): token is string => Boolean(token));
  return parts.length > 0 ? parts.join(' · ') : input.bookingReference;
}

function buildOccupancyLine(input: DriverPushMessageInput): string | null {
  const pax =
    typeof input.passengerCount === 'number' && input.passengerCount > 0 ? input.passengerCount : null;
  const bags = typeof input.bagCount === 'number' && input.bagCount > 0 ? input.bagCount : null;
  if (pax == null && bags == null) {
    return null;
  }
  const parts: string[] = [];
  if (pax != null) {
    parts.push(`${pax} passenger${pax === 1 ? '' : 's'}`);
  }
  if (bags != null) {
    parts.push(`${bags} bag${bags === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

function buildVehicleLine(input: DriverPushMessageInput): string | null {
  const displayCategory = formatDisplayToken(input.vehicleCategoryId);
  const displayModel = formatDisplayToken(input.vehicleModelId);
  if (!displayCategory && !displayModel) {
    return null;
  }
  return [displayCategory, displayModel].filter((token) => token).join(' · ');
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
  const bookingType = input.bookingType?.toLowerCase() ?? '';
  if (bookingType === 'hourly' || bookingType === 'daily') {
    return null;
  }

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

function buildBookingDurationLine(input: DriverPushMessageInput): string | null {
  const type = input.bookingType?.toLowerCase() ?? '';

  if (type === 'hourly' && input.hoursRequested && input.hoursRequested > 0) {
    return `${input.hoursRequested} hour${input.hoursRequested > 1 ? 's' : ''} booked`;
  }
  if (type === 'daily' && input.daysRequested && input.daysRequested > 0) {
    return `${input.daysRequested} day${input.daysRequested > 1 ? 's' : ''} booked`;
  }
  if (type === 'fleet' && input.fleetTotalLegs && input.fleetTotalLegs > 1) {
    const leg =
      input.legNumber && input.legNumber > 0 ? ` · Leg ${input.legNumber}/${input.fleetTotalLegs}` : '';
    return `Fleet · ${input.fleetTotalLegs} vehicles${leg}`;
  }
  if (input.legKind?.toLowerCase() === 'return') {
    return 'Return leg';
  }
  if (input.legNumber && input.legNumber > 1) {
    return `Leg ${input.legNumber}`;
  }
  return null;
}

function buildReturnTimeLine(returnScheduledAt: string | null | undefined): string | null {
  if (!returnScheduledAt) {
    return null;
  }
  const formatted = formatJobCardDateTime(returnScheduledAt);
  return formatted ? `Return: ${formatted}` : null;
}

export type DriverPushTitleLabel = 'New job' | 'Job accepted';

export function buildDriverPushMessage(
  input: DriverPushMessageInput,
  options?: { titleLabel?: DriverPushTitleLabel }
): { title: string; message: string } {
  const whenLine = formatJobCardDateTime(input.scheduledAt);
  const titleWhen = formatDriverPushDateTimeShort(input.scheduledAt);
  const pickupLine = input.pickupAddress ? formatLocationLine(input.pickupAddress) : null;
  const dropoffLine = input.dropoffAddress ? formatLocationLine(input.dropoffAddress) : null;
  const bookingType = input.bookingType?.toLowerCase() ?? 'oneway';
  const showDropoff = dropoffLine && bookingType !== 'hourly';

  const defaultTitleParts = [options?.titleLabel ?? 'New job'];
  if (input.payoutDisplay) {
    defaultTitleParts.push(input.payoutDisplay);
  }
  if (titleWhen) {
    defaultTitleParts.push(titleWhen);
  }

  const formattedSections = [
    buildHeaderLine(input),
    whenLine,
    pickupLine ? `🟢 ${pickupLine}` : null,
    showDropoff ? `🔴 ${dropoffLine}` : null,
    buildReturnTimeLine(input.returnScheduledAt),
    buildMetricsLine(input),
    buildBookingDurationLine(input),
    input.payoutBreakdownLine,
    buildVehicleLine(input),
    buildOccupancyLine(input),
    input.bookingReference
  ].filter((value): value is string => value !== null);

  return {
    title: defaultTitleParts.join(' • '),
    message:
      formattedSections.length > 0
        ? formattedSections.join('\n')
        : `New ${input.bookingReference} job available`
  };
}

/** Same layout/body as New Job push — only the title label changes to "Job accepted". */
export function buildDriverJobAcceptedPushMessage(
  input: DriverPushMessageInput
): { title: string; message: string } {
  return buildDriverPushMessage(input, { titleLabel: 'Job accepted' });
}

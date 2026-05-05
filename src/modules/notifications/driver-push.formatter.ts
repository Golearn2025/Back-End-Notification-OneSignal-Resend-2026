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

function getShortAddress(address: string): string {
  const primary = address.split(',')[0]?.trim() ?? '';
  return primary.length > 0 ? primary : address;
}

function getUkPostcode(address: string): string | null {
  const match = address.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i);
  return match?.[0]?.toUpperCase() ?? null;
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

export function buildDriverPushMessage(input: DriverPushMessageInput): { title: string; message: string } {
  const displayCategory = formatDisplayToken(input.vehicleCategoryId);
  const displayModel = formatDisplayToken(input.vehicleModelId);
  const displayBookingTypeRaw = formatDisplayToken(input.bookingType);
  const displayBookingType =
    displayBookingTypeRaw?.toLowerCase() === 'oneway' ? 'One way' : displayBookingTypeRaw;
  const displayWhen = formatDriverPushDateTime(input.scheduledAt) ?? input.scheduledAt ?? '';
  const titleWhen = formatDriverPushDateTimeShort(input.scheduledAt);
  const pickupPostcode = getUkPostcode(input.pickupAddress);
  const dropoffPostcode = getUkPostcode(input.dropoffAddress);
  const pickupDisplay = getShortAddress(input.pickupAddress);
  const dropoffDisplay = getShortAddress(input.dropoffAddress);

  const defaultTitleParts = ['New job'];
  if (input.payoutDisplay) {
    defaultTitleParts.push(input.payoutDisplay);
  }
  if (titleWhen) {
    defaultTitleParts.push(titleWhen);
  }

  const formattedSections = [
    input.pickupAddress ? `🟢 Pickup: ${pickupDisplay}${pickupPostcode ? ` (${pickupPostcode})` : ''}` : null,
    input.dropoffAddress
      ? `🔴 Drop-off: ${dropoffDisplay}${dropoffPostcode ? ` (${dropoffPostcode})` : ''}`
      : null,
    displayWhen ? `When: ${displayWhen}` : null,
    displayBookingType ? `Trip: ${displayBookingType}` : null,
    displayCategory || displayModel
      ? `Vehicle: ${[displayCategory, displayModel].filter((token) => token).join(' / ')}`
      : null,
    `Reference: ${input.bookingReference}`
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

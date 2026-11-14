/**
 * SSOT for customer/driver-facing date-times in emails and push copy.
 * Vantage Lane operations are UK — always format in Europe/London, never server local.
 */
export const SERVICE_TIME_ZONE = 'Europe/London';
export const SERVICE_LOCALE = 'en-GB';
/** Short suffix for email bodies / lines (industry: label the zone). */
export const UK_TIME_LABEL = 'UK time';

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Calendar Y-M-D in Europe/London (for today/tomorrow comparisons). */
export function ukCalendarDayKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SERVICE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

export function formatUkDate(
  value: string | Date | null | undefined,
  style: 'long' | 'short' = 'long'
): string {
  const parsed = parseDate(value);
  if (!parsed) {
    return typeof value === 'string' ? value : '';
  }
  if (style === 'short') {
    return parsed.toLocaleDateString(SERVICE_LOCALE, {
      timeZone: SERVICE_TIME_ZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }
  return parsed.toLocaleDateString(SERVICE_LOCALE, {
    timeZone: SERVICE_TIME_ZONE,
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

export function formatUkTime(
  value: string | Date | null | undefined,
  hour12 = false
): string {
  const parsed = parseDate(value);
  if (!parsed) {
    return typeof value === 'string' ? value : '';
  }
  return parsed.toLocaleTimeString(SERVICE_LOCALE, {
    timeZone: SERVICE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12
  });
}

/** e.g. "14 Nov 2026, 14:30" in London. */
export function formatUkDateTime(
  value: string | Date | null | undefined,
  opts?: { month?: 'short' | 'long'; hour12?: boolean }
): string {
  const parsed = parseDate(value);
  if (!parsed) {
    return typeof value === 'string' ? value : '';
  }
  return parsed.toLocaleString(SERVICE_LOCALE, {
    timeZone: SERVICE_TIME_ZONE,
    year: 'numeric',
    month: opts?.month ?? 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: opts?.hour12 ?? false
  });
}

/** Same as formatUkDateTime + " (UK time)" for customer emails. */
export function formatUkDateTimeWithLabel(
  value: string | Date | null | undefined,
  opts?: { month?: 'short' | 'long'; hour12?: boolean }
): string {
  const formatted = formatUkDateTime(value, opts);
  if (!formatted) {
    return '';
  }
  return `${formatted} (${UK_TIME_LABEL})`;
}

/** Next civil calendar day after a London Y-M-D key (handles month/year rollover). */
function nextCalendarDayKey(dayKey: string): string {
  const parts = dayKey.split('-').map((p) => Number(p));
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Job-card style: "Today, 2:30 pm" / "Tomorrow, …" / "Mon 14 Nov, …" — always London.
 */
export function formatUkJobCardDateTime(value: string | Date | null | undefined): string | null {
  const date = parseDate(value);
  if (!date) {
    return null;
  }

  const time = formatUkTime(date, true);
  const dayKey = ukCalendarDayKey(date);
  const todayKey = ukCalendarDayKey(new Date());
  const tomorrowKey = nextCalendarDayKey(todayKey);

  if (dayKey === todayKey) {
    return `Today, ${time}`;
  }
  if (dayKey === tomorrowKey) {
    return `Tomorrow, ${time}`;
  }

  const dateStr = date.toLocaleDateString(SERVICE_LOCALE, {
    timeZone: SERVICE_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  return `${dateStr}, ${time}`;
}

/** Compact: "14 Nov, 14:30" London — push short lines. */
export function formatUkDateTimeShort(value: string | Date | null | undefined): string | null {
  const parsed = parseDate(value);
  if (!parsed) {
    return null;
  }
  return formatUkDateTime(parsed, { month: 'short' });
}

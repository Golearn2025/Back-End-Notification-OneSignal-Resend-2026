import type { NotificationEvent } from './notification.types.js';

export const RETRY_MS = 5 * 60 * 1000;
export const DEFAULT_WEBSITE_URL = 'https://vantage-lane.com';
export const DEFAULT_SUPPORT_EMAIL = 'info@vantage-lane.com';
export const DEFAULT_SUPPORT_PHONE = '+44 20 4620 3131';
export const RESEND_TEMPLATE_ID = 'c27ab80b-22ef-4249-a5d1-f78ed1d72f8d';
export const RESEND_TEMPLATE_ALIAS = 'customer_account_created_v1';
export const PAYMENT_TEMPLATE_ALIAS = 'payment_success_customer_v1';
export const JOBS_MAILBOX_TEMPLATE_ALIAS = 'jobs_mailbox_booking_confirmed_v1';
export const DRIVER_JOB_ACCEPTED_TEMPLATE_ALIAS = 'driver_job_accepted_v1';
export const JOBS_MAILBOX_ADDRESS = 'newjobs@vantage-lane.com';

export function nextRetryAtIso(): string {
  return new Date(Date.now() + RETRY_MS).toISOString();
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatDisplayToken(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatCreatedDate(event: Pick<NotificationEvent, 'occurred_at' | 'created_at'>): string {
  const source = asNonEmptyString(event.occurred_at) ?? asNonEmptyString(event.created_at);
  if (!source) {
    return new Date().toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: '2-digit'
    });
  }
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    return source;
  }
  return parsed.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: '2-digit'
  });
}

export function getBookingLineValue(payload: Record<string, unknown>, expectedLabel: string): string | null {
  for (let i = 1; i <= 6; i += 1) {
    const label = asNonEmptyString(payload[`booking_line_${i}_label`]);
    const value = asNonEmptyString(payload[`booking_line_${i}_value`]);
    if (!label || !value) {
      continue;
    }
    if (label.toLowerCase() === expectedLabel.toLowerCase()) {
      return value;
    }
  }
  return null;
}

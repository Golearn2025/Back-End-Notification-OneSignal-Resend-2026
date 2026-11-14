import type { NotificationDeliveryStatus, NotificationEvent } from './notification.types.js';

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

/** Job dispatch / accept — must not wait behind admin campaigns or bulk email. */
export const URGENT_JOB_EVENT_TYPES = new Set([
  'driver_job_available',
  'driver_job_accepted'
]);

export const ADMIN_DRIVER_EVENT_TYPES = new Set([
  'admin_driver_system',
  'admin_driver_documents',
  'admin_driver_jobs'
]);

export function nextRetryAtIso(retryAfterSeconds?: number): string {
  const delayMs =
    typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(Math.max(retryAfterSeconds, 1) * 1000, 15 * 60 * 1000)
      : RETRY_MS;
  return new Date(Date.now() + delayMs).toISOString();
}

export function isUrgentJobEventType(eventType: string): boolean {
  return URGENT_JOB_EVENT_TYPES.has(eventType);
}

export function isAdminDriverEventType(eventType: string): boolean {
  return ADMIN_DRIVER_EVENT_TYPES.has(eventType);
}

export function adminPushFingerprint(input: {
  organizationId: string;
  title: string;
  message: string;
  eventType: string;
}): string {
  return [input.organizationId, input.eventType, input.title, input.message].join('\u0000');
}

export function isDeliverySucceeded(status: NotificationDeliveryStatus): boolean {
  return (
    status === 'provider_accepted' ||
    status === 'delivered' ||
    status === 'sent' ||
    status === 'opened' ||
    status === 'clicked'
  );
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

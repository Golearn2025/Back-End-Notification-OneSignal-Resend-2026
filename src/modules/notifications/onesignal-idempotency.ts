import { createHash } from 'node:crypto';

/**
 * Stable OneSignal Idempotency-Key for a push attempt.
 * Same event + sorted audience + content → same key across retries
 * (covers “provider accepted, response lost, DB not updated”).
 */
export function buildOneSignalIdempotencyKey(input: {
  eventId: string;
  externalUserIds: string[];
  title: string;
  message: string;
  data?: Record<string, string>;
}): string {
  const audience = [...new Set(input.externalUserIds.map((id) => id.trim()).filter(Boolean))].sort().join(',');
  const dataPart = input.data
    ? Object.keys(input.data)
        .sort()
        .map((k) => `${k}=${input.data?.[k] ?? ''}`)
        .join('&')
    : '';
  const material = [input.eventId, audience, input.title, input.message, dataPart].join('\u0000');
  const digest = createHash('sha256').update(material).digest('hex').slice(0, 32);
  return `vl-push:${input.eventId}:${digest}`;
}

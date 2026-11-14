import { randomUUID } from 'node:crypto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** OneSignal `idempotency_key` / Idempotency-Key header must be a UUID. */
export function isOneSignalIdempotencyKey(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Fresh UUID for a new logical OneSignal send (persist before first HTTP call). */
export function createOneSignalIdempotencyKey(): string {
  return randomUUID();
}

/** Reuse a previously persisted UUID; otherwise mint a new one. */
export function resolveOneSignalIdempotencyKey(existing?: string | null): string {
  if (typeof existing === 'string' && isOneSignalIdempotencyKey(existing)) {
    return existing.trim();
  }
  return createOneSignalIdempotencyKey();
}

export type PersistedOneSignalRequest = {
  idempotency_key: string;
  external_user_ids: string[];
  title: string;
  message: string;
  data?: Record<string, string>;
};

export function readPersistedOneSignalRequest(
  payload: Record<string, unknown> | null | undefined
): PersistedOneSignalRequest | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const key = payload.onesignal_idempotency_key;
  const audience = payload.onesignal_original_audience;
  const title = payload.onesignal_original_title;
  const message = payload.onesignal_original_message;
  if (typeof key !== 'string' || !isOneSignalIdempotencyKey(key)) {
    return null;
  }
  if (!Array.isArray(audience) || audience.length === 0) {
    return null;
  }
  if (typeof title !== 'string' || typeof message !== 'string') {
    return null;
  }
  const externalUserIds = audience.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  if (externalUserIds.length === 0) {
    return null;
  }
  const dataRaw = payload.onesignal_original_data;
  const data =
    dataRaw && typeof dataRaw === 'object' && !Array.isArray(dataRaw)
      ? Object.fromEntries(
          Object.entries(dataRaw as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : undefined;
  return {
    idempotency_key: key.trim(),
    external_user_ids: [...new Set(externalUserIds.map((id) => id.trim()))].sort(),
    title,
    message,
    ...(data && Object.keys(data).length > 0 ? { data } : {})
  };
}

export function buildPersistedOneSignalPayloadPatch(request: PersistedOneSignalRequest): Record<string, unknown> {
  return {
    onesignal_idempotency_key: request.idempotency_key,
    onesignal_original_audience: request.external_user_ids,
    onesignal_original_title: request.title,
    onesignal_original_message: request.message,
    ...(request.data ? { onesignal_original_data: request.data } : {})
  };
}

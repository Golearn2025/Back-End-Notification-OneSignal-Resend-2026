import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { buildOneSignalIdempotencyKey } from '../notifications/onesignal-idempotency.js';

export type SendOneSignalExternalUserPushInput = {
  externalUserId: string;
  title: string;
  message: string;
  data?: Record<string, string>;
  /** Stable across retries for the same logical send. */
  idempotencyKey?: string;
  timeoutMs?: number;
};

export type SendOneSignalExternalUsersPushInput = {
  externalUserIds: string[];
  title: string;
  message: string;
  data?: Record<string, string>;
  /**
   * Required for safe retries. If omitted, derived from sorted audience + content
   * (callers should still pass event-scoped keys when available).
   */
  idempotencyKey?: string;
  timeoutMs?: number;
};

export type SendOneSignalExternalUserPushResult = {
  providerMessageId: string;
  idempotencyKey: string;
  responseMetadata: {
    recipients?: number;
    external_id?: string;
    invalidExternalIds?: string[];
  };
};

const DEFAULT_TIMEOUT_MS = 15_000;

function extractInvalidExternalIds(errors: unknown): string[] {
  if (!errors || typeof errors !== 'object') {
    return [];
  }
  const invalidAliases = (errors as { invalid_aliases?: { external_id?: unknown } }).invalid_aliases;
  const raw = invalidAliases?.external_id;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function isPermanentOneSignalFailure(statusCode: number, errors: unknown): boolean {
  if (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404) {
    return true;
  }
  const invalid = extractInvalidExternalIds(errors);
  return invalid.length > 0 && statusCode === 200;
}

export class OneSignalProvider {
  async sendPushToExternalUserId(
    input: SendOneSignalExternalUserPushInput
  ): Promise<SendOneSignalExternalUserPushResult> {
    return this.sendPushToExternalUserIds({
      externalUserIds: [input.externalUserId],
      title: input.title,
      message: input.message,
      ...(input.data ? { data: input.data } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.timeoutMs != null ? { timeoutMs: input.timeoutMs } : {})
    });
  }

  /**
   * OneSignal accepts multiple external_id aliases in a single notification when
   * content (title/body/data) is identical. Callers must still track deliveries per recipient.
   *
   * Idempotency-Key is sent so retries after a lost response do not create a second notification
   * for the same logical audience+content.
   */
  async sendPushToExternalUserIds(
    input: SendOneSignalExternalUsersPushInput
  ): Promise<SendOneSignalExternalUserPushResult> {
    const env = getEnv();
    const appId = env.ONESIGNAL_APP_ID;
    const restApiKey = env.ONESIGNAL_REST_API_KEY;

    if (!appId || !restApiKey) {
      throw new Error('OneSignal config missing: ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY');
    }

    const externalUserIds = [
      ...new Set(input.externalUserIds.map((id) => id.trim()).filter(Boolean))
    ].sort();
    if (externalUserIds.length === 0) {
      throw new Error('OneSignal send failed: empty externalUserIds');
    }

    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      buildOneSignalIdempotencyKey({
        eventId: 'anonymous',
        externalUserIds,
        title: input.title,
        message: input.message,
        ...(input.data ? { data: input.data } : {})
      });

    const body: Record<string, unknown> = {
      app_id: appId,
      include_aliases: {
        external_id: externalUserIds
      },
      target_channel: 'push',
      headings: { en: input.title },
      contents: { en: input.message },
      // Also embed for provider-side correlation / debugging.
      idempotency_key: idempotencyKey
    };

    if (input.data && Object.keys(input.data).length > 0) {
      body.data = input.data;
    }

    const timeoutMs =
      typeof input.timeoutMs === 'number' && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${restApiKey}`,
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted =
        (error instanceof Error && error.name === 'AbortError') ||
        (typeof error === 'object' && error != null && 'name' in error && (error as { name: string }).name === 'AbortError');
      const err = new Error(
        aborted
          ? `OneSignal send failed: timeout after ${timeoutMs}ms`
          : `OneSignal send failed: network error ${error instanceof Error ? error.message : 'unknown'}`
      ) as Error & { retryAfterSeconds?: number; permanent?: boolean; idempotencyKey?: string };
      err.permanent = false;
      err.idempotencyKey = idempotencyKey;
      if (aborted) {
        err.retryAfterSeconds = 5;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const retryAfterHeader = response.headers.get('retry-after');
    const payload = (await response.json()) as {
      id?: string;
      recipients?: number;
      external_id?: string;
      errors?: unknown;
    };

    const invalidExternalIds = extractInvalidExternalIds(payload.errors);

    if (response.ok && payload.id) {
      const responseMetadata: SendOneSignalExternalUserPushResult['responseMetadata'] = {
        invalidExternalIds
      };
      if (typeof payload.recipients === 'number') {
        responseMetadata.recipients = payload.recipients;
      }
      if (typeof payload.external_id === 'string') {
        responseMetadata.external_id = payload.external_id;
      }

      if (invalidExternalIds.length >= externalUserIds.length) {
        logger.warn(
          { statusCode: response.status, provider: 'onesignal', invalidExternalIds, idempotencyKey },
          'OneSignal push request failed'
        );
        const err = new Error(
          `OneSignal send failed: status=${response.status} errors=${JSON.stringify(payload.errors ?? null)}`
        ) as Error & { retryAfterSeconds?: number; permanent?: boolean; idempotencyKey?: string };
        err.permanent = true;
        err.idempotencyKey = idempotencyKey;
        throw err;
      }

      return {
        providerMessageId: payload.id,
        idempotencyKey,
        responseMetadata
      };
    }

    logger.warn(
      {
        statusCode: response.status,
        provider: 'onesignal',
        idempotencyKey
      },
      'OneSignal push request failed'
    );

    const err = new Error(
      `OneSignal send failed: status=${response.status} errors=${JSON.stringify(payload.errors ?? null)}`
    ) as Error & { retryAfterSeconds?: number; permanent?: boolean; idempotencyKey?: string };

    if (retryAfterHeader) {
      const parsed = Number(retryAfterHeader);
      if (Number.isFinite(parsed) && parsed > 0) {
        err.retryAfterSeconds = parsed;
      }
    }
    err.permanent = isPermanentOneSignalFailure(response.status, payload.errors);
    err.idempotencyKey = idempotencyKey;
    throw err;
  }
}

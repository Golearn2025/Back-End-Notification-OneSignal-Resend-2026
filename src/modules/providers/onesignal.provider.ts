import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export type SendOneSignalExternalUserPushInput = {
  externalUserId: string;
  title: string;
  message: string;
  data?: Record<string, string>;
};

export type SendOneSignalExternalUsersPushInput = {
  externalUserIds: string[];
  title: string;
  message: string;
  data?: Record<string, string>;
};

export type SendOneSignalExternalUserPushResult = {
  providerMessageId: string;
  responseMetadata: {
    recipients?: number;
    external_id?: string;
    invalidExternalIds?: string[];
  };
};

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
      ...(input.data ? { data: input.data } : {})
    });
  }

  /**
   * OneSignal accepts multiple external_id aliases in a single notification when
   * content (title/body/data) is identical. Callers must still track deliveries per recipient.
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

    const externalUserIds = [...new Set(input.externalUserIds.map((id) => id.trim()).filter(Boolean))];
    if (externalUserIds.length === 0) {
      throw new Error('OneSignal send failed: empty externalUserIds');
    }

    const body: Record<string, unknown> = {
      app_id: appId,
      include_aliases: {
        external_id: externalUserIds
      },
      target_channel: 'push',
      headings: { en: input.title },
      contents: { en: input.message }
    };

    if (input.data && Object.keys(input.data).length > 0) {
      body.data = input.data;
    }

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${restApiKey}`
      },
      body: JSON.stringify(body)
    });

    const retryAfterHeader = response.headers.get('retry-after');
    const payload = (await response.json()) as {
      id?: string;
      recipients?: number;
      external_id?: string;
      errors?: unknown;
    };

    const invalidExternalIds = extractInvalidExternalIds(payload.errors);

    // OneSignal may return HTTP 200 with id even when some aliases are invalid.
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

      // All aliases invalid → treat as failure for the batch.
      if (invalidExternalIds.length >= externalUserIds.length) {
        logger.warn(
          { statusCode: response.status, provider: 'onesignal', invalidExternalIds },
          'OneSignal push request failed'
        );
        const err = new Error(
          `OneSignal send failed: status=${response.status} errors=${JSON.stringify(payload.errors ?? null)}`
        ) as Error & { retryAfterSeconds?: number; permanent?: boolean };
        err.permanent = true;
        throw err;
      }

      return {
        providerMessageId: payload.id,
        responseMetadata
      };
    }

    logger.warn(
      {
        statusCode: response.status,
        provider: 'onesignal'
      },
      'OneSignal push request failed'
    );

    const err = new Error(
      `OneSignal send failed: status=${response.status} errors=${JSON.stringify(payload.errors ?? null)}`
    ) as Error & { retryAfterSeconds?: number; permanent?: boolean };

    if (retryAfterHeader) {
      const parsed = Number(retryAfterHeader);
      if (Number.isFinite(parsed) && parsed > 0) {
        err.retryAfterSeconds = parsed;
      }
    }
    err.permanent = isPermanentOneSignalFailure(response.status, payload.errors);
    throw err;
  }
}

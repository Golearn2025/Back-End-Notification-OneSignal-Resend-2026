import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export type SendOneSignalExternalUserPushInput = {
  externalUserId: string;
  title: string;
  message: string;
  data?: Record<string, string>;
};

export type SendOneSignalExternalUserPushResult = {
  providerMessageId: string;
  responseMetadata: {
    recipients?: number;
    external_id?: string;
  };
};

export class OneSignalProvider {
  async sendPushToExternalUserId(
    input: SendOneSignalExternalUserPushInput
  ): Promise<SendOneSignalExternalUserPushResult> {
    const env = getEnv();
    const appId = env.ONESIGNAL_APP_ID;
    const restApiKey = env.ONESIGNAL_REST_API_KEY;

    if (!appId || !restApiKey) {
      throw new Error('OneSignal config missing: ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY');
    }

    const body: Record<string, unknown> = {
      app_id: appId,
      include_aliases: {
        external_id: [input.externalUserId]
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

    const payload = (await response.json()) as {
      id?: string;
      recipients?: number;
      external_id?: string;
      errors?: unknown;
    };

    if (!response.ok || !payload.id) {
      logger.warn(
        {
          statusCode: response.status,
          provider: 'onesignal'
        },
        'OneSignal push request failed'
      );
      throw new Error(
        `OneSignal send failed: status=${response.status} errors=${JSON.stringify(payload.errors ?? null)}`
      );
    }

    const responseMetadata: SendOneSignalExternalUserPushResult['responseMetadata'] = {};
    if (typeof payload.recipients === 'number') {
      responseMetadata.recipients = payload.recipients;
    }
    if (typeof payload.external_id === 'string') {
      responseMetadata.external_id = payload.external_id;
    }

    return {
      providerMessageId: payload.id,
      responseMetadata
    };
  }
}

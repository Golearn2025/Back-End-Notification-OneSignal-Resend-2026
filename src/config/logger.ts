import pino, { type LoggerOptions } from 'pino';

export const loggerOptions: LoggerOptions = {
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  redact: {
    // Never log raw tokens or secrets.
    paths: [
      '*.authorization',
      '*.token',
      '*.apiKey',
      '*.secret',
      '*.deviceToken',
      '*.device_token',
      '*.providerToken',
      '*.provider_token',
      '**.authorization',
      '**.token',
      '**.apiKey',
      '**.secret',
      '**.deviceToken',
      '**.device_token',
      '**.providerToken',
      '**.provider_token',
      'req.headers.authorization',
      'req.headers.x-internal-api-secret',
      'headers.authorization',
      'headers.x-internal-api-secret',
      'payload.token',
      'payload.apiKey',
      'payload.secret',
      'payload.deviceToken',
      'payload.device_token',
      'payload.providerToken',
      'payload.provider_token',
      '**.payload.token',
      '**.payload.apiKey',
      '**.payload.secret',
      '**.payload.deviceToken',
      '**.payload.device_token',
      '**.payload.providerToken',
      '**.payload.provider_token',
      'SUPABASE_SERVICE_ROLE_KEY',
      'ONESIGNAL_REST_API_KEY',
      'RESEND_API_KEY',
      'RESEND_TEMPLATE_AUDIT_API_KEY'
    ],
    censor: '[REDACTED]'
  }
};

export const logger = pino(loggerOptions);

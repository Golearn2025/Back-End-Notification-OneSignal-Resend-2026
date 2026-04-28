import { getEnv } from './env.js';

export type ResendConfig = {
  apiKey: string | undefined;
  fromEmail: string | undefined;
};

export const resendConfig: ResendConfig = {
  apiKey: getEnv().RESEND_API_KEY,
  fromEmail: getEnv().RESEND_FROM_EMAIL
};

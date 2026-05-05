import { getEnv } from './env.js';

export type ResendConfig = {
  apiKey: string | undefined;
  fromEmail: string | undefined;
  /** For Resend Templates API (create/publish); optional, separate from send key. */
  templateAuditApiKey: string | undefined;
};

export const resendConfig: ResendConfig = {
  apiKey: getEnv().RESEND_API_KEY,
  fromEmail: getEnv().RESEND_FROM_EMAIL,
  templateAuditApiKey: getEnv().RESEND_TEMPLATE_AUDIT_API_KEY
};

import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_WHATSAPP,
  DEFAULT_WEBSITE_URL,
  RESEND_TEMPLATE_ALIAS
} from '../../notifications/notification-shared.js';
import type { SendResendTemplateInput } from './send-template.types.js';

export type SendCustomerAccountCreatedEmailInput = {
  to: string;
  customerFirstName: unknown;
  createdDate: unknown;
  websiteUrl: unknown;
  supportEmail?: unknown;
  supportPhone?: unknown;
  supportWhatsapp?: unknown;
};

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function digitsOnly(value: string): string {
  return value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}

function e164Digits(value: string): string {
  const raw = digitsOnly(value);
  return raw.startsWith('+') ? raw.slice(1) : raw;
}

export function buildCustomerAccountCreatedTemplateSend(
  input: SendCustomerAccountCreatedEmailInput
): SendResendTemplateInput {
  const supportEmail = text(input.supportEmail, DEFAULT_SUPPORT_EMAIL);
  const supportPhone = text(input.supportPhone, DEFAULT_SUPPORT_PHONE);
  const supportWhatsapp = text(input.supportWhatsapp, DEFAULT_SUPPORT_WHATSAPP);
  const websiteUrl = text(input.websiteUrl, DEFAULT_WEBSITE_URL);

  return {
    to: input.to,
    templateIdOrAlias: RESEND_TEMPLATE_ALIAS,
    subject: 'Welcome to Vantage Lane',
    replyTo: supportEmail,
    tags: [{ name: 'event_type', value: 'customer_account_created' }],
    variables: {
      customer_first_name: text(input.customerFirstName, 'there'),
      created_date: text(input.createdDate),
      website_url: websiteUrl,
      support_email: supportEmail,
      support_phone: supportPhone,
      support_whatsapp: supportWhatsapp,
      support_email_href: `mailto:${supportEmail}`,
      support_phone_href: `tel:${digitsOnly(supportPhone)}`,
      support_whatsapp_href: `https://wa.me/${e164Digits(supportWhatsapp)}`
    }
  };
}

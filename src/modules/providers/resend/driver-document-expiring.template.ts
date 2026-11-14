import { DEFAULT_SUPPORT_EMAIL } from '../../notifications/notification-shared.js';
import type { SendResendTemplateInput } from './send-template.types.js';

export const DRIVER_DOCUMENT_EXPIRING_TEMPLATE_ALIAS = 'driver_document_expiring_v1';

export type SendDriverDocumentExpiringEmailInput = {
  to: string;
  driverFirstName: unknown;
  documentLabel: unknown;
  expiryDate: unknown;
  daysLeft: unknown;
  headline: unknown;
  bodyText: unknown;
  supportEmail?: unknown;
};

export function buildDriverDocumentExpiringTemplateSend(
  input: SendDriverDocumentExpiringEmailInput
): SendResendTemplateInput {
  const days =
    typeof input.daysLeft === 'number'
      ? String(input.daysLeft)
      : String(input.daysLeft ?? '');

  return {
    to: input.to,
    templateIdOrAlias: DRIVER_DOCUMENT_EXPIRING_TEMPLATE_ALIAS,
    subject:
      days === '1' || days === '0'
        ? 'Document expiring soon — Vantage Lane'
        : `Document expires in ${days} days — Vantage Lane`,
    replyTo: DEFAULT_SUPPORT_EMAIL,
    tags: [{ name: 'event_type', value: 'driver_document_expiring' }],
    variables: {
      driver_first_name: input.driverFirstName,
      document_label: input.documentLabel,
      expiry_date: input.expiryDate,
      days_left: days,
      headline: input.headline,
      body_text: input.bodyText,
      support_email: input.supportEmail ?? DEFAULT_SUPPORT_EMAIL
    }
  };
}

export type SendResendTemplateInput = {
  to: string;
  templateIdOrAlias: string;
  variables: Record<string, unknown>;
  subject?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
};

export type SendResendTemplateResult = {
  providerMessageId: string;
};

export type ResendEmailAttachment = {
  filename: string;
  /** Base64 content */
  content: string;
  contentType?: string;
};

export type SendResendTemplateInput = {
  to: string;
  templateIdOrAlias: string;
  variables: Record<string, unknown>;
  subject?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
  attachments?: ResendEmailAttachment[];
};

export type SendResendTemplateResult = {
  providerMessageId: string;
};

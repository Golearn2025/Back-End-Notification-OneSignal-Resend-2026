const SUBJECT = 'Your Vantage Lane account has been created';

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeFirstName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'there';
  }
  const t = value.trim();
  return t.length > 0 ? t : 'there';
}

export function getCustomerAccountCreatedSubject(): string {
  return SUBJECT;
}

export function buildCustomerAccountCreatedText(customerFirstName: unknown): string {
  const name = normalizeFirstName(customerFirstName);
  return [
    `Hello ${name},`,
    'Your Vantage Lane account has been created successfully.',
    'You can now manage your bookings and receive important journey updates.',
    '',
    'Vantage Lane'
  ].join('\n');
}

/**
 * Simple transactional layout; no marketing, no unsubscribe.
 */
export function buildCustomerAccountCreatedHtml(customerFirstName: unknown): string {
  const name = escapeHtml(normalizeFirstName(customerFirstName));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f6f6f6;">
  <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="background-color:#f6f6f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:8px;padding:32px 28px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111111;">
          <tr>
            <td>
              <p style="margin:0 0 16px 0;">Hello ${name},</p>
              <p style="margin:0 0 16px 0;">Your Vantage Lane account has been created successfully.</p>
              <p style="margin:0 0 0 0;">You can now manage your bookings and receive important journey updates.</p>
              <p style="margin:32px 0 0 0;">Vantage Lane</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

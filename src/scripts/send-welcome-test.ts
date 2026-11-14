/**
 * One-off: send customer_account_created_v1 to an email.
 * Usage: npx tsx src/scripts/send-welcome-test.ts [toEmail] [firstName]
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResendProvider } from '../modules/providers/resend.provider.js';
import { formatUkDate } from '../modules/notifications/uk-datetime.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: join(ROOT, '.env') });

async function main(): Promise<void> {
  const to = process.argv[2]?.trim() || 'test@vantage-lane.com';
  const firstName = process.argv[3]?.trim() || 'Test';
  const resend = new ResendProvider();
  const result = await resend.sendCustomerAccountCreatedEmail({
    to,
    customerFirstName: firstName,
    createdDate: formatUkDate(new Date(), 'long'),
    websiteUrl: 'https://vantage-lane.com',
    supportEmail: 'contact@vantage-lane.com',
    supportPhone: '+44 20 4534 7305',
    supportWhatsapp: '+44 7376 188443'
  });
  console.log(JSON.stringify({ ok: true, to, providerMessageId: result.providerMessageId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

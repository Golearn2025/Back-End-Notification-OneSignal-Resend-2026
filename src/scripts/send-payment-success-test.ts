/**
 * One-off: send payment_success_customer_v1 to an email with CB-001030-shaped data.
 * Usage: npx tsx src/scripts/send-payment-success-test.ts [toEmail]
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResendProvider } from '../modules/providers/resend.provider.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: join(ROOT, '.env') });

async function main(): Promise<void> {
  const to = process.argv[2]?.trim() || 'test@vantage-lane.com';
  const resend = new ResendProvider();
  const result = await resend.sendBookingPaymentConfirmedEmail({
    to,
    customerFirstName: 'Dmitry',
    invoiceNumber: 'Pending',
    paymentDate: '13 November 2026 at 20:03 (UK time)',
    paymentMethod: 'manual',
    amountPaid: '170.00',
    currency: 'GBP',
    receiptUrl: 'https://vantage-lane.com',
    bookingReference: 'CB-001030',
    bookingTypeLabel: 'One Way',
    pickupTime: '14 November 2026 at 15:15 (UK time)',
    pickupAddress: 'Terminal 5, Wallis Rd, Longford, Hounslow TW6 2GA, UK',
    dropoffAddress: 'N2 0TP, Winnington Rd, London N2 0TP, UK',
    flightNumber: 'BA571',
    categoryLabel: 'Executive',
    vehicleLabel: 'Mercedes E-Class',
    passengersLuggage: '2 / 2',
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

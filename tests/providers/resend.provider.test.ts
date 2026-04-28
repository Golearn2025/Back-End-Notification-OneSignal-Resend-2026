import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendProvider } from '../../src/modules/providers/resend.provider.js';

describe('ResendProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds template payload with reply_to and tags', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4001';
    process.env.INTERNAL_API_SECRET = 'test-secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.RESEND_API_KEY = 're_key';
    process.env.RESEND_FROM_EMAIL = 'Vantage Lane <hello@example.com>';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 're_msg_root' })
    } as Response);

    const provider = new ResendProvider();
    const result = await provider.sendTemplateEmail({
      to: 'a@b.com',
      templateIdOrAlias: 'customer_account_created_v1',
      subject: 'Welcome to Vantage Lane',
      replyTo: 'info@vantage-lane.com',
      tags: [{ name: 'event_type', value: 'customer_account_created' }],
      variables: {
        customer_first_name: 'C',
        created_date: '01 January 2026',
        website_url: 'https://vantage-lane.com',
        support_email: 'info@vantage-lane.com',
        support_phone: '+44 20 4620 3131'
      }
    });

    expect(result.providerMessageId).toBe('re_msg_root');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body));
    expect(payload.template.id).toBe('customer_account_created_v1');
    expect(payload.reply_to).toEqual(['info@vantage-lane.com']);
    expect(payload.tags).toEqual([{ name: 'event_type', value: 'customer_account_created' }]);
  });

  it('escapes template variables before send', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4001';
    process.env.INTERNAL_API_SECRET = 'test-secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.RESEND_API_KEY = 're_key';
    process.env.RESEND_FROM_EMAIL = 'Vantage Lane <hello@example.com>';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 're_msg_root' })
    } as Response);

    const provider = new ResendProvider();
    await provider.sendTemplateEmail({
      to: 'a@b.com',
      templateIdOrAlias: 'customer_account_created_v1',
      variables: {
        customer_first_name: '<script>alert(1)</script>'
      }
    });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body));
    expect(payload.template.variables.customer_first_name).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('builds booking_payment_confirmed template payload', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4001';
    process.env.INTERNAL_API_SECRET = 'test-secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.RESEND_API_KEY = 're_key';
    process.env.RESEND_FROM_EMAIL = 'Vantage Lane <hello@example.com>';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 're_msg_payment' })
    } as Response);

    const provider = new ResendProvider();
    await provider.sendBookingPaymentConfirmedEmail({
      to: 'a@b.com',
      customerFirstName: 'John',
      invoiceNumber: 'INV-2026-0001',
      paymentDate: '27 April 2026',
      paymentMethod: 'Visa',
      amountPaid: '145.00',
      currency: 'GBP',
      receiptUrl: 'https://vantage-lane.com',
      bookingLine1Label: 'Booking Type',
      bookingLine1Value: 'Return',
      bookingLine2Label: 'Reference',
      bookingLine2Value: 'CB-000535',
      bookingLine3Label: 'Outbound',
      bookingLine3Value: 'A -> B',
      bookingLine4Label: 'Outbound Time',
      bookingLine4Value: '27 April 2026, 18:30',
      bookingLine5Label: 'Return',
      bookingLine5Value: 'B -> A',
      bookingLine6Label: 'Return Time',
      bookingLine6Value: '30 April 2026, 14:00',
      supportEmail: 'info@vantage-lane.com',
      supportPhone: '+44 20 4620 3131'
    });

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body));
    expect(payload.template.id).toBe('payment_success_customer_v1');
    expect(payload.template.variables.invoice_number).toBe('INV-2026-0001');
    expect(payload.template.variables.booking_line_6_value).toBe('30 April 2026, 14:00');
    expect(payload.reply_to).toEqual(['info@vantage-lane.com']);
    expect(payload.tags).toEqual([{ name: 'event_type', value: 'booking_payment_confirmed' }]);
  });
});

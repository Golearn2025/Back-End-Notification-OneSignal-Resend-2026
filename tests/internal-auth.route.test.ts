import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app/create-app.js';

describe('internal notifications test route auth', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4001';
    process.env.INTERNAL_API_SECRET = 'test-secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  it('requires INTERNAL_API_SECRET header', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/internal/notifications/test/customer-account-created',
      payload: {
        organizationId: '11111111-1111-1111-1111-111111111111',
        customerId: '22222222-2222-2222-2222-222222222222',
        customerEmail: 'customer@example.com',
        customerFirstName: 'Test'
      }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('requires INTERNAL_API_SECRET header for onesignal smoke route', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/internal/notifications/test/onesignal-driver-push',
      payload: {
        organizationId: '11111111-1111-1111-1111-111111111111',
        driverId: '22222222-2222-2222-2222-222222222222',
        title: 'Smoke',
        message: 'Test'
      }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('requires INTERNAL_API_SECRET header for payment success smoke route', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/internal/notifications/test/payment-success-customer',
      payload: {
        bookingId: '11111111-1111-1111-1111-111111111111'
      }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

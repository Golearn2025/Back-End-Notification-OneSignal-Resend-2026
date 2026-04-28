import { afterEach, describe, expect, it, vi } from 'vitest';
import { OneSignalProvider } from '../../src/modules/providers/onesignal.provider.js';

describe('OneSignalProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trimite push și returnează provider message id la succes', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4001';
    process.env.INTERNAL_API_SECRET = 'test-secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ONESIGNAL_APP_ID = 'app-id';
    process.env.ONESIGNAL_REST_API_KEY = 'rest-api-key';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'os-msg-123', recipients: 1 })
    } as Response);

    const provider = new OneSignalProvider();
    const result = await provider.sendPushToExternalUserId({
      externalUserId: 'ba1cafee-bb73-43f9-80df-57138e4793fc',
      title: 'Test',
      message: 'Smoke test'
    });

    expect(result.providerMessageId).toBe('os-msg-123');
    expect(result.responseMetadata.recipients).toBe(1);
  });

  it('aruncă eroare la răspuns invalid de la OneSignal', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4001';
    process.env.INTERNAL_API_SECRET = 'test-secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ONESIGNAL_APP_ID = 'app-id';
    process.env.ONESIGNAL_REST_API_KEY = 'rest-api-key';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ errors: ['Invalid alias'] })
    } as Response);

    const provider = new OneSignalProvider();

    await expect(
      provider.sendPushToExternalUserId({
        externalUserId: 'ba1cafee-bb73-43f9-80df-57138e4793fc',
        title: 'Test',
        message: 'Smoke test'
      })
    ).rejects.toThrow('OneSignal send failed');
  });
});

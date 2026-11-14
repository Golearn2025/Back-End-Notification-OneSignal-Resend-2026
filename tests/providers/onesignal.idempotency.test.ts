import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOneSignalIdempotencyKey,
  isOneSignalIdempotencyKey
} from '../../src/modules/notifications/onesignal-idempotency.js';
import { OneSignalProvider } from '../../src/modules/providers/onesignal.provider.js';
import { resetEnvCacheForTests } from '../../src/config/env.js';

describe('OneSignal idempotency + timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetEnvCacheForTests();
    delete process.env.ONESIGNAL_APP_ID;
    delete process.env.ONESIGNAL_REST_API_KEY;
    delete process.env.ONESIGNAL_ANDROID_CHANNEL_ID;
    delete process.env.PORT;
    delete process.env.INTERNAL_API_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  function stubEnv() {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4002';
    process.env.INTERNAL_API_SECRET = 'test';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.ONESIGNAL_APP_ID = 'app-id';
    process.env.ONESIGNAL_REST_API_KEY = 'rest-key';
    delete process.env.ONESIGNAL_ANDROID_CHANNEL_ID;
    delete process.env.ONESIGNAL_PREFER_DASHBOARD_CHANNEL;
    resetEnvCacheForTests();
  }

  it('sends UUID Idempotency-Key header and stable sorted audience', async () => {
    stubEnv();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Response(JSON.stringify({ id: 'os-1', recipients: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OneSignalProvider();
    const key = createOneSignalIdempotencyKey();
    expect(isOneSignalIdempotencyKey(key)).toBe(true);

    await provider.sendPushToExternalUserIds({
      externalUserIds: ['b', 'a'],
      title: 'T',
      message: 'M',
      idempotencyKey: key
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(key);
    const body = JSON.parse(String(init.body));
    expect(body.include_aliases.external_id).toEqual(['a', 'b']);
    expect(body.idempotency_key).toBe(key);
    expect(isOneSignalIdempotencyKey(body.idempotency_key)).toBe(true);
    // Without dashboard UUID → app channel fallback + resource name `message`
    expect(body.ios_sound).toBe('message.caf');
    expect(body.android_sound).toBe('message');
    expect(body.existing_android_channel_id).toBe('driver_alerts_v2');
    expect(body.android_channel_id).toBeUndefined();
  });

  it('uses dashboard android_channel_id when prefer-dashboard is enabled', async () => {
    stubEnv();
    const dashboardId = '11111111-2222-4333-8444-555555555555';
    process.env.ONESIGNAL_ANDROID_CHANNEL_ID = dashboardId;
    process.env.ONESIGNAL_PREFER_DASHBOARD_CHANNEL = '1';
    resetEnvCacheForTests();

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 'os-ch', recipients: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OneSignalProvider();
    await provider.sendPushToExternalUserIds({
      externalUserIds: ['u1'],
      title: 'T',
      message: 'M',
      idempotencyKey: createOneSignalIdempotencyKey()
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.android_channel_id).toBe(dashboardId);
    expect(body.android_sound).toBe('message');
    expect(body.existing_android_channel_id).toBeUndefined();
    expect(body.ios_sound).toBe('message.caf');
  });

  it('reuses the same UUID on retry after lost response', async () => {
    stubEnv();
    const keys: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        keys.push(String(headers['Idempotency-Key'] ?? ''));
        throw Object.assign(new Error('network drop after accept'), { name: 'TypeError' });
      })
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        keys.push(String(headers['Idempotency-Key'] ?? ''));
        return new Response(JSON.stringify({ id: 'os-same', recipients: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OneSignalProvider();
    const key = createOneSignalIdempotencyKey();

    await expect(
      provider.sendPushToExternalUserIds({
        externalUserIds: ['u1'],
        title: 'T',
        message: 'M',
        idempotencyKey: key
      })
    ).rejects.toThrow(/network/);

    const second = await provider.sendPushToExternalUserIds({
      externalUserIds: ['u1'],
      title: 'T',
      message: 'M',
      idempotencyKey: key
    });

    expect(keys[0]).toBe(key);
    expect(keys[1]).toBe(key);
    expect(second.providerMessageId).toBe('os-same');
    expect(second.idempotencyKey).toBe(key);
  });

  it('times out controlled and marks retryable', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
        return new Response('{}');
      })
    );

    const provider = new OneSignalProvider();
    const key = createOneSignalIdempotencyKey();
    await expect(
      provider.sendPushToExternalUserIds({
        externalUserIds: ['u1'],
        title: 'T',
        message: 'M',
        idempotencyKey: key,
        timeoutMs: 20
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('timeout'),
      permanent: false,
      idempotencyKey: key
    });
  });
});

import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

describe('env validation', () => {
  const baseEnv = {
    NODE_ENV: 'development',
    PORT: '4001',
    INTERNAL_API_SECRET: 'secret',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
  };

  it('fails when required env is missing', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'development',
        PORT: '4001',
        INTERNAL_API_SECRET: 'secret',
        SUPABASE_URL: 'https://example.supabase.co'
        // missing SUPABASE_SERVICE_ROLE_KEY
      })
    ).toThrowError(/Invalid environment variables/);
  });

  it('defaults WORKER_MODE to once and poll interval to 5000', () => {
    const parsed = parseEnv(baseEnv);
    expect(parsed.WORKER_MODE).toBe('once');
    expect(parsed.WORKER_POLL_INTERVAL_MS).toBe(5000);
    expect(parsed.SUPABASE_REALTIME_ENABLED).toBe(false);
    expect(parsed.SUPABASE_REALTIME_CHANNEL).toBe('notification-events');
    expect(parsed.SUPABASE_ANON_KEY).toBeUndefined();
    expect(parsed.SUPABASE_REALTIME_KEY).toBeUndefined();
    expect(parsed.SUPABASE_REALTIME_DISABLE_PROXY).toBe(true);
  });

  it('fails fast for invalid WORKER_MODE', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        WORKER_MODE: 'invalid'
      })
    ).toThrowError(/Invalid environment variables/);
  });

  it('fails fast when WORKER_POLL_INTERVAL_MS is below minimum', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        WORKER_POLL_INTERVAL_MS: '999'
      })
    ).toThrowError(/Invalid environment variables/);
  });
});

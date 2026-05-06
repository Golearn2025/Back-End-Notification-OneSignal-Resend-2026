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
    expect(parsed.SUPABASE_REALTIME_DISABLE_PROXY).toBe(false);
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

  it('rejects RESEND_API_KEY that is not a Resend secret (must start with re_)', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        RESEND_API_KEY: 'sk_live_not_resend',
        RESEND_FROM_EMAIL: 'Test <test@example.com>'
      })
    ).toThrowError(/Invalid environment variables/);
  });

  it('requires RESEND_FROM_EMAIL when RESEND_API_KEY is set', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        RESEND_API_KEY: 're_valid_key_format_123'
      })
    ).toThrowError(/Invalid environment variables/);
  });

  it('requires RESEND_API_KEY when RESEND_FROM_EMAIL is set', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        RESEND_FROM_EMAIL: 'Test <test@example.com>'
      })
    ).toThrowError(/Invalid environment variables/);
  });

  it('accepts paired Resend env with valid API key prefix', () => {
    const parsed = parseEnv({
      ...baseEnv,
      RESEND_API_KEY: 're_test_integration_key_01',
      RESEND_FROM_EMAIL: 'Vantage Lane <hello@example.com>'
    });
    expect(parsed.RESEND_API_KEY).toBe('re_test_integration_key_01');
    expect(parsed.RESEND_FROM_EMAIL).toBe('Vantage Lane <hello@example.com>');
  });

  it('treats empty RESEND_API_KEY as unset (no pairing error)', () => {
    const parsed = parseEnv({
      ...baseEnv,
      RESEND_API_KEY: '',
      RESEND_FROM_EMAIL: ''
    });
    expect(parsed.RESEND_API_KEY).toBeUndefined();
    expect(parsed.RESEND_FROM_EMAIL).toBeUndefined();
  });

  it('allows RESEND_TEMPLATE_AUDIT_API_KEY alone (no RESEND_FROM_EMAIL)', () => {
    const parsed = parseEnv({
      ...baseEnv,
      RESEND_TEMPLATE_AUDIT_API_KEY: 're_templates_audit_only_01'
    });
    expect(parsed.RESEND_TEMPLATE_AUDIT_API_KEY).toBe('re_templates_audit_only_01');
    expect(parsed.RESEND_API_KEY).toBeUndefined();
  });

  it('rejects invalid RESEND_TEMPLATE_AUDIT_API_KEY format', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        RESEND_TEMPLATE_AUDIT_API_KEY: 'not_re_key'
      })
    ).toThrowError(/Invalid environment variables/);
  });
});

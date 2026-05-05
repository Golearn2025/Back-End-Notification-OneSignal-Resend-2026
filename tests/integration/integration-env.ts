import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resetEnvCacheForTests } from '../../src/config/env.js';

export function hasSupabaseCredentials(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() &&
      !process.env.SUPABASE_URL?.includes('example.supabase.co')
  );
}

export function hasResendCredentials(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim());
}

/** Minimal env for `getEnv()` / `getSupabaseAdmin()` inside repositories. */
export function loadBackendEnvFromProcess(): void {
  resetEnvCacheForTests();
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  process.env.PORT = process.env.PORT ?? '4002';
  process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? 'integration_placeholder';
  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
}

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

export async function fetchFirstOrganizationId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.from('organizations').select('id').limit(1).maybeSingle();
  if (error) {
    throw new Error(`organizations lookup failed: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('No organization row found (need at least one org in DB)');
  }
  return data.id as string;
}

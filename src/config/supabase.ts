import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { getEnv } from './env.js';

// Service role key is used only inside this internal backend.
let supabaseAdmin: ReturnType<typeof createClient> | null = null;
let supabaseRealtime: ReturnType<typeof createClient> | null = null;

function applyRealtimeProxyBypass(supabaseUrl: string): void {
  const host = new URL(supabaseUrl).hostname;
  const noProxyKeys: Array<'NO_PROXY' | 'no_proxy'> = ['NO_PROXY', 'no_proxy'];
  for (const key of noProxyKeys) {
    const current = process.env[key] ?? '';
    const values = current
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.includes(host)) {
      values.push(host);
      values.push(`.${host.split('.').slice(-2).join('.')}`);
      process.env[key] = values.join(',');
    }
  }

  const proxyKeys: Array<
    | 'HTTP_PROXY'
    | 'HTTPS_PROXY'
    | 'ALL_PROXY'
    | 'http_proxy'
    | 'https_proxy'
    | 'all_proxy'
    | 'SOCKS_PROXY'
    | 'SOCKS5_PROXY'
    | 'socks_proxy'
    | 'socks5_proxy'
  > = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'SOCKS_PROXY',
    'SOCKS5_PROXY',
    'socks_proxy',
    'socks5_proxy'
  ];

  for (const key of proxyKeys) {
    delete process.env[key];
  }
}

export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    const env = getEnv();
    supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }

  return supabaseAdmin;
}

export function getSupabaseRealtimeClient() {
  if (!supabaseRealtime) {
    const env = getEnv();
    if (env.SUPABASE_REALTIME_DISABLE_PROXY) {
      applyRealtimeProxyBypass(env.SUPABASE_URL);
    }
    const realtimeKey = env.SUPABASE_REALTIME_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
    supabaseRealtime = createClient(env.SUPABASE_URL, realtimeKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      realtime: {
        transport: WebSocket as unknown as typeof globalThis.WebSocket,
        params: {
          eventsPerSecond: 10
        }
      }
    });
  }

  return supabaseRealtime;
}

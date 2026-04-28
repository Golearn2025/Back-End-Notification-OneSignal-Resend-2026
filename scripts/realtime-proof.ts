import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';
import WebSocket from 'ws';

type RealtimeStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CHANNEL_ERROR' | 'CLOSED';

function requiredEnv(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function maskHostname(supabaseUrl: string): string {
  const hostname = new URL(supabaseUrl).hostname;
  return hostname.replace(/^[^.]+/, '***');
}

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

  const proxyKeys = [
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
  ] as const;
  for (const key of proxyKeys) {
    delete process.env[key];
  }
}

async function main(): Promise<void> {
  const require = createRequire(import.meta.url);
  const supabasePackage = require('@supabase/supabase-js/package.json') as { version?: string };
  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const realtimeKey = process.env.SUPABASE_REALTIME_KEY ?? requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const keyMode = process.env.SUPABASE_REALTIME_KEY ? 'SUPABASE_REALTIME_KEY' : 'SUPABASE_SERVICE_ROLE_KEY';
  applyRealtimeProxyBypass(supabaseUrl);

  console.log('REALTIME_PROOF_START', {
    host: maskHostname(supabaseUrl),
    nodeVersion: process.version,
    supabaseJsVersion: supabasePackage.version ?? 'unknown',
    keyMode,
    keepAliveMs: 120_000
  });

  const supabase = createClient(supabaseUrl, realtimeKey, {
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

  const channel = supabase
    .channel('realtime-proof-notification-events')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notification_events'
      },
      (payload) => {
        const row = (payload.new ?? {}) as Record<string, unknown>;
        console.log('REALTIME_INSERT_RECEIVED', {
          id: row.id ?? null,
          event_type: row.event_type ?? null,
          status: row.status ?? null,
          created_at: row.created_at ?? null
        });
      }
    )
    .subscribe((status: RealtimeStatus, err?: Error) => {
      console.log('REALTIME_STATUS', status, err ? String(err) : null);
    });

  let shuttingDown = false;
  const shutdown = async (signal: 'SIGINT' | 'SIGTERM' | 'TIMEOUT') => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log('REALTIME_PROOF_SHUTDOWN', { signal });
    try {
      await supabase.removeChannel(channel);
    } catch (error) {
      console.log('REALTIME_PROOF_REMOVE_CHANNEL_ERROR', {
        error: error instanceof Error ? error.message : 'unknown'
      });
    } finally {
      process.exit(0);
    }
  };

  setTimeout(() => {
    void shutdown('TIMEOUT');
  }, 120_000);

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('REALTIME_PROOF_FAILED', {
    error: error instanceof Error ? error.message : 'unknown'
  });
  process.exit(1);
});

import { createClient } from '@supabase/supabase-js';

type RealtimeStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CHANNEL_ERROR' | 'CLOSED';

function requiredEnv(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const keepAliveMs = 2 * 60 * 1000;

  const client = createClient(supabaseUrl, serviceRoleKey);

  console.log(
    JSON.stringify({
      msg: 'Realtime smoke test starting',
      keepAliveMs
    })
  );

  const channel = client
    .channel('notification-events-smoke')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notification_events'
      },
      (payload) => {
        const row = (payload.new ?? {}) as Record<string, unknown>;
        console.log(
          JSON.stringify({
            msg: 'Realtime INSERT received',
            id: row.id ?? null,
            event_type: row.event_type ?? null,
            status: row.status ?? null,
            created_at: row.created_at ?? null
          })
        );
      }
    )
    .subscribe((status: RealtimeStatus) => {
      console.log(
        JSON.stringify({
          msg: 'Realtime status transition',
          status
        })
      );
    });

  let shuttingDown = false;
  const safeShutdown = async (signal: 'SIGINT' | 'SIGTERM' | 'TIMEOUT') => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(JSON.stringify({ msg: 'Realtime smoke test shutting down', signal }));
    try {
      await client.removeChannel(channel);
    } catch (error) {
      console.log(
        JSON.stringify({
          msg: 'Realtime smoke test unsubscribe failed',
          error: error instanceof Error ? error.message : 'unknown'
        })
      );
    } finally {
      process.exit(0);
    }
  };

  setTimeout(() => {
    void safeShutdown('TIMEOUT');
  }, keepAliveMs);

  process.on('SIGINT', () => {
    void safeShutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void safeShutdown('SIGTERM');
  });
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      msg: 'Realtime smoke test failed',
      error: error instanceof Error ? error.message : 'unknown'
    })
  );
  process.exit(1);
});

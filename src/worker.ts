import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { WorkerManager } from './modules/worker/worker-manager.js';
import { SupabaseRealtimeListener } from './modules/realtime/supabase-realtime-listener.js';

type WorkerBootDeps = {
  mode: 'once' | 'loop';
  pollIntervalMs: number;
  batchSize: number;
  workerEnabled: boolean;
  realtimeEnabled: boolean;
  realtimeChannel: string;
  logger: {
    info: (context: unknown, message?: string) => void;
    warn: (context: unknown, message?: string) => void;
  };
  createManager: () => { start: () => Promise<void>; stop: () => void; requestWakeUp: (reason: string) => void };
  createRealtimeListener: (onWakeUp: (reason: string) => void) => {
    start: () => void;
    stop: () => Promise<void>;
  };
};

export async function bootstrapWorker(
  deps: WorkerBootDeps = {
    mode: getEnv().WORKER_MODE,
    pollIntervalMs: getEnv().WORKER_POLL_INTERVAL_MS,
    batchSize: getEnv().WORKER_BATCH_SIZE,
    workerEnabled: getEnv().WORKER_ENABLED,
    realtimeEnabled: getEnv().SUPABASE_REALTIME_ENABLED,
    realtimeChannel: getEnv().SUPABASE_REALTIME_CHANNEL,
    logger,
    createManager: () =>
      new WorkerManager({
        mode: getEnv().WORKER_MODE,
        pollIntervalMs: getEnv().WORKER_POLL_INTERVAL_MS,
        batchSize: getEnv().WORKER_BATCH_SIZE
      }),
    createRealtimeListener: (onWakeUp) =>
      new SupabaseRealtimeListener({
        channelName: getEnv().SUPABASE_REALTIME_CHANNEL,
        onWakeUp
      })
  }
) {
  if (!deps.workerEnabled) {
    deps.logger.info({ mode: deps.mode }, 'WORKER_ENABLED is false. Worker will not start.');
    return 'disabled' as const;
  }

  const manager = deps.createManager();
  let realtimeListener: { start: () => void; stop: () => Promise<void> } | null = null;

  if (deps.realtimeEnabled) {
    try {
      realtimeListener = deps.createRealtimeListener((reason) => manager.requestWakeUp(reason));
      realtimeListener.start();
      deps.logger.info(
        { channel: deps.realtimeChannel },
        'Supabase realtime listener enabled'
      );
    } catch (error) {
      deps.logger.warn(
        {
          channel: deps.realtimeChannel,
          reason: error instanceof Error ? error.message : 'unknown'
        },
        'Realtime listener failed to start; polling fallback remains active'
      );
    }
  }

  const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    deps.logger.warn({ signal, mode: deps.mode }, 'Worker shutdown signal received');
    manager.stop();
    if (realtimeListener) {
      void realtimeListener.stop();
    }
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  deps.logger.info(
    {
      mode: deps.mode,
      pollIntervalMs: deps.pollIntervalMs,
      batchSize: deps.batchSize
    },
    'Bootstrapping worker'
  );
  await manager.start();
  if (realtimeListener) {
    await realtimeListener.stop();
  }
  return 'started' as const;
}

const isMainModule =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] as string);

if (isMainModule) {
  bootstrapWorker().catch((error) => {
    console.error('Failed to start worker', error);
    process.exit(1);
  });
}

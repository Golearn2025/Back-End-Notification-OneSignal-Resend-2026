import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCacheForTests } from '../src/config/env.js';
import { bootstrapWorker } from '../src/worker.js';

describe('worker behavior', () => {
  beforeEach(() => {
    resetEnvCacheForTests();
    process.env.PORT = '4002';
    process.env.INTERNAL_API_SECRET = 'secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  });

  it('does not start manager when WORKER_ENABLED is false', async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(() => undefined);
    const requestWakeUp = vi.fn();
    const listenerStart = vi.fn();
    const listenerStop = vi.fn(async () => undefined);

    const result = await bootstrapWorker({
      mode: 'once',
      pollIntervalMs: 5000,
      batchSize: 20,
      workerEnabled: false,
      realtimeEnabled: false,
      realtimeChannel: 'notification-events',
      logger: { info, warn },
      createManager: () => ({ start, stop, requestWakeUp }),
      createRealtimeListener: () => ({ start: listenerStart, stop: listenerStop })
    });

    expect(result).toBe('disabled');
    expect(start).not.toHaveBeenCalled();
    expect(listenerStart).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      { mode: 'once' },
      'WORKER_ENABLED is false. Worker will not start.'
    );
  });
});

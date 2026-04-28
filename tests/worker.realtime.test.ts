import { describe, expect, it, vi } from 'vitest';
import { bootstrapWorker } from '../src/worker.js';

describe('worker realtime integration', () => {
  it('starts realtime listener when enabled', async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(() => undefined);
    const requestWakeUp = vi.fn();
    const listenerStart = vi.fn(() => undefined);
    const listenerStop = vi.fn(async () => undefined);

    await bootstrapWorker({
      mode: 'once',
      pollIntervalMs: 5000,
      batchSize: 5,
      workerEnabled: true,
      realtimeEnabled: true,
      realtimeChannel: 'notification-events',
      logger: { info, warn },
      createManager: () => ({ start, stop, requestWakeUp }),
      createRealtimeListener: () => ({ start: listenerStart, stop: listenerStop })
    });

    expect(listenerStart).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('continues with polling fallback when realtime start fails', async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(() => undefined);
    const requestWakeUp = vi.fn();

    await bootstrapWorker({
      mode: 'once',
      pollIntervalMs: 5000,
      batchSize: 5,
      workerEnabled: true,
      realtimeEnabled: true,
      realtimeChannel: 'notification-events',
      logger: { info, warn },
      createManager: () => ({ start, stop, requestWakeUp }),
      createRealtimeListener: () => {
        throw new Error('boom');
      }
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'notification-events', reason: 'boom' }),
      'Realtime listener failed to start; polling fallback remains active'
    );
  });
});

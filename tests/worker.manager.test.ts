import { describe, expect, it, vi } from 'vitest';
import { WorkerManager } from '../src/modules/worker/worker-manager.js';

describe('WorkerManager', () => {
  it('once mode processes one batch', async () => {
    const pollingRunOnce = vi.fn(async () => ({ fetched: 1, processed: 1 }));
    const retryRunOnce = vi.fn(async () => undefined);
    const info = vi.fn();
    const warn = vi.fn();

    const manager = new WorkerManager({
      mode: 'once',
      batchSize: 5,
      pollingWorker: { runOnce: pollingRunOnce },
      retryWorker: { runOnce: retryRunOnce },
      logger: { info, warn }
    });

    await manager.start();

    expect(pollingRunOnce).toHaveBeenCalledTimes(1);
    expect(pollingRunOnce).toHaveBeenCalledWith(5);
    expect(retryRunOnce).toHaveBeenCalledTimes(1);
  });

  it('loop mode does not overlap batches', async () => {
    let callCount = 0;
    const pollingRunOnce = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return { fetched: 1, processed: 1 };
    });
    const retryRunOnce = vi.fn(async () => undefined);
    const info = vi.fn();
    const warn = vi.fn();

    const manager = new WorkerManager({
      mode: 'loop',
      pollIntervalMs: 10,
      batchSize: 3,
      pollingWorker: { runOnce: pollingRunOnce },
      retryWorker: { runOnce: retryRunOnce },
      logger: { info, warn }
    });

    const running = manager.start();
    await new Promise((resolve) => setTimeout(resolve, 70));
    manager.stop();
    await running;

    expect(pollingRunOnce.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(retryRunOnce).toHaveBeenCalledTimes(pollingRunOnce.mock.calls.length);
  });

  it('realtime wake-up triggers an immediate extra batch', async () => {
    const pollingRunOnce = vi.fn(async () => ({ fetched: 0, processed: 0 }));
    const retryRunOnce = vi.fn(async () => undefined);
    const info = vi.fn();
    const warn = vi.fn();

    const manager = new WorkerManager({
      mode: 'loop',
      pollIntervalMs: 60_000,
      wakeUpDebounceMs: 5,
      batchSize: 2,
      pollingWorker: { runOnce: pollingRunOnce },
      retryWorker: { runOnce: retryRunOnce },
      logger: { info, warn }
    });

    const running = manager.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const beforeWake = pollingRunOnce.mock.calls.length;
    manager.requestWakeUp('realtime-test');
    await new Promise((resolve) => setTimeout(resolve, 40));
    manager.stop();
    await running;

    expect(pollingRunOnce.mock.calls.length).toBeGreaterThan(beforeWake);
  });

  it('coalesces burst wake-up requests into one immediate batch', async () => {
    const pollingRunOnce = vi.fn(async () => ({ fetched: 0, processed: 0 }));
    const retryRunOnce = vi.fn(async () => undefined);
    const info = vi.fn();
    const warn = vi.fn();

    const manager = new WorkerManager({
      mode: 'loop',
      pollIntervalMs: 60_000,
      wakeUpDebounceMs: 10,
      batchSize: 2,
      pollingWorker: { runOnce: pollingRunOnce },
      retryWorker: { runOnce: retryRunOnce },
      logger: { info, warn }
    });

    const running = manager.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const beforeWake = pollingRunOnce.mock.calls.length;

    manager.requestWakeUp('burst-1');
    manager.requestWakeUp('burst-2');
    manager.requestWakeUp('burst-3');

    await new Promise((resolve) => setTimeout(resolve, 60));
    const afterWake = pollingRunOnce.mock.calls.length;

    manager.stop();
    await running;

    expect(afterWake).toBeGreaterThan(beforeWake);
    expect(afterWake).toBeLessThanOrEqual(beforeWake + 2);
    expect(
      info.mock.calls.filter((call) => call[1] === 'Worker wake-up requested').length
    ).toBe(1);
  });
});

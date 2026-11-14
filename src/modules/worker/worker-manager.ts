import { logger } from '../../config/logger.js';
import { PollingWorker } from './polling-worker.js';
import { RetryWorker } from './retry-worker.js';

type WorkerMode = 'once' | 'loop';

type WorkerManagerDeps = {
  mode?: WorkerMode;
  pollIntervalMs?: number;
  batchSize?: number;
  pollingWorker?: { runOnce: (batchSize: number) => Promise<unknown> };
  retryWorker?: { runOnce: () => Promise<void> };
  logger?: {
    info: (context: unknown, message?: string) => void;
    warn: (context: unknown, message?: string) => void;
  };
  sleep?: (ms: number) => Promise<void>;
  wakeUpDebounceMs?: number;
};

export class WorkerManager {
  private readonly mode: WorkerMode;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly pollingWorker: { runOnce: (batchSize: number) => Promise<unknown> };
  private readonly retryWorker: { runOnce: () => Promise<void> };
  private readonly workerLogger: {
    info: (context: unknown, message?: string) => void;
    warn: (context: unknown, message?: string) => void;
  };
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly wakeUpDebounceMs: number;
  private running = false;
  private processing = false;
  private wakeUpPending = false;
  private wakeUpQueued = false;
  private wakeUpDebounceTimer: NodeJS.Timeout | null = null;
  private waitTimer: NodeJS.Timeout | null = null;
  private waitResolver: (() => void) | null = null;

  constructor(deps: WorkerManagerDeps = {}) {
    this.mode = deps.mode ?? 'once';
    this.pollIntervalMs = deps.pollIntervalMs ?? 5000;
    this.batchSize = deps.batchSize ?? 20;
    this.pollingWorker = deps.pollingWorker ?? new PollingWorker();
    this.retryWorker = deps.retryWorker ?? new RetryWorker();
    this.workerLogger = deps.logger ?? logger;
    this.sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.wakeUpDebounceMs = deps.wakeUpDebounceMs ?? 250;
  }

  async start(): Promise<void> {
    this.running = true;
    this.workerLogger.info(
      {
        mode: this.mode,
        pollIntervalMs: this.pollIntervalMs,
        batchSize: this.batchSize
      },
      'Worker manager starting'
    );

    if (this.mode === 'once') {
      await this.processSingleBatch();
      this.running = false;
      return;
    }

    while (this.running) {
      let morePendingLikely = false;
      let lanesBusy = false;
      if (this.processing) {
        this.workerLogger.warn(
          { mode: this.mode, pollIntervalMs: this.pollIntervalMs },
          'Skipping poll tick because previous batch is still running'
        );
      } else {
        const tick = await this.processSingleBatch();
        morePendingLikely = tick.morePendingLikely;
        lanesBusy = tick.lanesBusy;
      }

      if (!this.running) {
        break;
      }
      if (this.wakeUpPending) {
        this.wakeUpPending = false;
        continue;
      }
      // Do not sleep the fixed poll interval while claimable work remains.
      if (morePendingLikely) {
        continue;
      }
      // Background admin still running and/or category backlog while slots are full:
      // brief yield so requestWakeUp can start urgent/interrupt lanes without a 30s pause.
      if (lanesBusy) {
        await this.sleep(Math.min(50, this.pollIntervalMs));
        continue;
      }
      await this.waitForNextTick();
    }
  }

  stop(): void {
    this.running = false;
    this.wakeUpPending = false;
    this.wakeUpQueued = false;
    if (this.wakeUpDebounceTimer) {
      clearTimeout(this.wakeUpDebounceTimer);
      this.wakeUpDebounceTimer = null;
    }
    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    if (this.waitResolver) {
      const resolve = this.waitResolver;
      this.waitResolver = null;
      resolve();
    }
  }

  requestWakeUp(reason: string): void {
    if (!this.running) {
      return;
    }
    if (this.wakeUpQueued || this.wakeUpPending) {
      return;
    }

    this.wakeUpQueued = true;
    if (this.wakeUpDebounceTimer) {
      clearTimeout(this.wakeUpDebounceTimer);
      this.wakeUpDebounceTimer = null;
    }
    this.wakeUpDebounceTimer = setTimeout(() => {
      this.wakeUpDebounceTimer = null;
      this.wakeUpQueued = false;
      this.wakeUpPending = true;
      this.workerLogger.info({ reason }, 'Worker wake-up requested');

      if (this.waitResolver) {
        const resolve = this.waitResolver;
        this.waitResolver = null;
        if (this.waitTimer) {
          clearTimeout(this.waitTimer);
          this.waitTimer = null;
        }
        resolve();
      }
    }, this.wakeUpDebounceMs);
  }

  private async processSingleBatch(): Promise<{ morePendingLikely: boolean; lanesBusy: boolean }> {
    this.processing = true;
    try {
      this.workerLogger.info(
        { mode: this.mode, batchSize: this.batchSize },
        'Worker batch start'
      );
      const stats = (await this.pollingWorker.runOnce(this.batchSize)) as {
        morePendingLikely?: boolean;
        fetched?: number;
        backlog?: { urgent?: boolean; admin?: boolean; email?: boolean };
        lanes?: { adminBusy?: boolean; urgentBusy?: boolean; emailBusy?: boolean };
      };
      await this.retryWorker.runOnce();
      this.workerLogger.info({ mode: this.mode, stats }, 'Worker batch end');
      const lanesBusy = Boolean(
        stats?.lanes?.adminBusy ||
          stats?.lanes?.urgentBusy ||
          stats?.lanes?.emailBusy ||
          stats?.backlog?.admin ||
          stats?.backlog?.urgent ||
          stats?.backlog?.email
      );
      if (typeof stats?.morePendingLikely === 'boolean') {
        return { morePendingLikely: stats.morePendingLikely, lanesBusy };
      }
      if (lanesBusy) {
        return { morePendingLikely: false, lanesBusy: true };
      }
      return {
        morePendingLikely: typeof stats?.fetched === 'number' && stats.fetched >= this.batchSize,
        lanesBusy: false
      };
    } finally {
      this.processing = false;
    }
  }

  private async waitForNextTick(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.waitResolver = resolve;
      this.waitTimer = setTimeout(() => {
        this.waitTimer = null;
        this.waitResolver = null;
        resolve();
      }, this.pollIntervalMs);
    });
  }
}

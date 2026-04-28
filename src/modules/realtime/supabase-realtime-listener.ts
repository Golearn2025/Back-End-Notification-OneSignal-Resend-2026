import { logger } from '../../config/logger.js';
import { getSupabaseRealtimeClient } from '../../config/supabase.js';

type RealtimePayload = {
  eventType?: string;
  new?: Record<string, unknown>;
};

type RealtimeListenerDeps = {
  channelName?: string;
  onWakeUp: (reason: string) => void;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  jitterRatio?: number;
  setTimeoutFn?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimeoutFn?: (timer: NodeJS.Timeout) => void;
  client?: {
    channel: (name: string) => {
      on: (
        event: string,
        filter: Record<string, string>,
        callback: (payload: RealtimePayload) => void
      ) => {
        subscribe: (
          callback?: (status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED') => void
        ) => unknown;
      };
    };
    removeChannel?: (channel: unknown) => Promise<unknown>;
  };
};

function isRetryEligible(nextRetryAt: unknown): boolean {
  if (typeof nextRetryAt !== 'string' || nextRetryAt.trim().length === 0) {
    return true;
  }
  const when = new Date(nextRetryAt);
  if (Number.isNaN(when.getTime())) {
    return false;
  }
  return when.getTime() <= Date.now();
}

function shouldWakeFromRow(row: Record<string, unknown>): boolean {
  const status = typeof row.status === 'string' ? row.status : '';
  if (status === 'pending' || status === 'ready') {
    return true;
  }
  if (status === 'failed_retryable') {
    return isRetryEligible(row.next_retry_at);
  }
  return false;
}

export class SupabaseRealtimeListener {
  private readonly channelName: string;
  private readonly onWakeUp: (reason: string) => void;
  private readonly client: RealtimeListenerDeps['client'];
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly jitterRatio: number;
  private readonly setTimeoutFn: (callback: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearTimeoutFn: (timer: NodeJS.Timeout) => void;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private channel: unknown | null = null;

  constructor(deps: RealtimeListenerDeps) {
    this.channelName = deps.channelName ?? 'notification-events';
    this.onWakeUp = deps.onWakeUp;
    this.reconnectBaseMs = deps.reconnectBaseMs ?? 2000;
    this.reconnectMaxMs = deps.reconnectMaxMs ?? 30000;
    this.jitterRatio = deps.jitterRatio ?? 0.2;
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
    this.client = deps.client ?? (getSupabaseRealtimeClient() as unknown as RealtimeListenerDeps['client']);
  }

  start(): void {
    this.stopping = false;
    logger.info({ channel: this.channelName }, 'Realtime listener starting');
    this.createChannel();
  }

  private createChannel(): void {
    const channel = this.client?.channel(this.channelName);
    if (!channel) {
      throw new Error('Supabase realtime client unavailable');
    }

    this.channel = channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notification_events' },
        (payload: RealtimePayload) => {
          const row =
            payload.eventType === 'DELETE'
              ? null
              : ((payload.new ?? {}) as Record<string, unknown>);
          if (!row || !shouldWakeFromRow(row)) {
            return;
          }
          logger.info(
            {
              eventId: row.id ?? null,
              eventType: row.event_type ?? null,
              eventStatus: row.status ?? null
            },
            'Realtime wake-up event received'
          );
          this.onWakeUp('supabase_realtime_event');
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.reconnectAttempt = 0;
          logger.info({ channel: this.channelName, status }, 'Realtime listener subscribed');
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          logger.warn(
            { channel: this.channelName, status },
            'Realtime listener degraded; polling fallback remains active'
          );
          this.scheduleReconnect(status);
          return;
        }
        if (status === 'CLOSED') {
          logger.warn(
            { channel: this.channelName, status },
            'Realtime listener channel closed'
          );
          if (!this.stopping) {
            this.scheduleReconnect(status);
          }
        }
      });
  }

  private scheduleReconnect(reason: 'TIMED_OUT' | 'CHANNEL_ERROR' | 'CLOSED'): void {
    if (this.stopping || this.reconnectTimer) {
      return;
    }

    const delay = this.computeReconnectDelayMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    logger.warn(
      { channel: this.channelName, reason, delayMs: delay, attempt: this.reconnectAttempt },
      'Realtime reconnect scheduled'
    );

    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
  }

  private computeReconnectDelayMs(attempt: number): number {
    const base = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** attempt);
    const jitter = Math.floor(base * this.jitterRatio * Math.random());
    return Math.min(this.reconnectMaxMs, base + jitter);
  }

  private async reconnect(): Promise<void> {
    if (this.stopping) {
      return;
    }
    try {
      await this.detachChannel();
    } catch (error) {
      logger.warn(
        {
          channel: this.channelName,
          reason: error instanceof Error ? error.message : 'unknown'
        },
        'Realtime channel detach failed; continuing with reconnect'
      );
    }
    logger.info({ channel: this.channelName }, 'Realtime listener reconnecting');
    try {
      this.createChannel();
    } catch (error) {
      logger.warn(
        {
          channel: this.channelName,
          reason: error instanceof Error ? error.message : 'unknown'
        },
        'Realtime reconnect failed; polling fallback remains active'
      );
      this.scheduleReconnect('CHANNEL_ERROR');
    }
  }

  private async detachChannel(): Promise<void> {
    if (!this.channel) {
      this.channel = null;
      return;
    }
    // NOTE: removeChannel currently triggers a runtime crash in our Node runtime/realtime-js stack:
    // "TypeError: connToClose.close is not a function".
    // To keep worker stability, we avoid explicit channel teardown here and rely on process lifecycle.
    logger.warn(
      { channel: this.channelName },
      'Skipping removeChannel to avoid realtime socket teardown crash'
    );
    this.channel = null;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      await this.detachChannel();
    } catch (error) {
      logger.warn(
        {
          channel: this.channelName,
          reason: error instanceof Error ? error.message : 'unknown'
        },
        'Realtime detach during stop failed'
      );
    }
    if (!this.client?.removeChannel) {
      logger.info({ channel: this.channelName }, 'Realtime listener stopped');
      return;
    }
    logger.info({ channel: this.channelName }, 'Realtime listener stopped');
  }
}

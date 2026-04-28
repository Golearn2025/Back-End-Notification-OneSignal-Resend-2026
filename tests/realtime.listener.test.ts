import { describe, expect, it, vi } from 'vitest';
import { SupabaseRealtimeListener } from '../src/modules/realtime/supabase-realtime-listener.js';

describe('SupabaseRealtimeListener', () => {
  async function flushAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function createHarness() {
    const channels: Array<{ subscribeCb?: (status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED') => void }> =
      [];
    const callbacks: Array<(payload: { eventType?: string; new?: Record<string, unknown> }) => void> = [];
    const client = {
      channel: vi.fn(() => {
        const state: { subscribeCb?: (status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED') => void } = {};
        channels.push(state);
        return {
          on: vi.fn((_event, _filter, cb) => {
            callbacks.push(cb);
            return {
              subscribe: vi.fn((cb2) => {
                state.subscribeCb = cb2;
                return {};
              })
            };
          })
        };
      }),
      removeChannel: vi.fn(async () => undefined)
    };
    return { client, callbacks, channels };
  }

  it('does not wake for non-eligible status', () => {
    const onWakeUp = vi.fn();
    const { client, callbacks } = createHarness();

    const listener = new SupabaseRealtimeListener({
      onWakeUp,
      client
    });
    listener.start();
    callbacks[0]?.({
      eventType: 'UPDATE',
      new: { id: 'evt-1', event_type: 'x', status: 'processing' }
    });

    expect(onWakeUp).not.toHaveBeenCalled();
  });

  it('wakes for pending insert events', () => {
    const onWakeUp = vi.fn();
    const { client, callbacks } = createHarness();

    const listener = new SupabaseRealtimeListener({
      onWakeUp,
      client
    });
    listener.start();
    callbacks[0]?.({
      eventType: 'INSERT',
      new: { id: 'evt-2', event_type: 'booking_payment_confirmed', status: 'pending' }
    });

    expect(onWakeUp).toHaveBeenCalledWith('supabase_realtime_event');
  });

  it('TIMED_OUT schedules reconnect and avoids duplicate schedule', async () => {
    const onWakeUp = vi.fn();
    const { client, channels } = createHarness();
    const scheduled: Array<{ callback: () => void; ms: number }> = [];
    const listener = new SupabaseRealtimeListener({
      onWakeUp,
      client,
      reconnectBaseMs: 2000,
      reconnectMaxMs: 30000,
      jitterRatio: 0,
      setTimeoutFn: ((cb: () => void, ms: number) => {
        scheduled.push({ callback: cb, ms });
        return {} as NodeJS.Timeout;
      }) as typeof setTimeout,
      clearTimeoutFn: vi.fn() as typeof clearTimeout
    });

    listener.start();
    channels[0]?.subscribeCb?.('TIMED_OUT');
    channels[0]?.subscribeCb?.('TIMED_OUT');

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.ms).toBe(2000);

    scheduled[0]?.callback();
    await flushAsync();
    await flushAsync();
    expect(client.removeChannel).toHaveBeenCalledTimes(0);
    expect(client.channel).toHaveBeenCalledTimes(2);
  });

  it('SUBSCRIBED resets backoff after reconnect', async () => {
    const onWakeUp = vi.fn();
    const { client, channels } = createHarness();
    const scheduled: Array<{ callback: () => void; ms: number }> = [];
    const listener = new SupabaseRealtimeListener({
      onWakeUp,
      client,
      reconnectBaseMs: 2000,
      reconnectMaxMs: 30000,
      jitterRatio: 0,
      setTimeoutFn: ((cb: () => void, ms: number) => {
        scheduled.push({ callback: cb, ms });
        return {} as NodeJS.Timeout;
      }) as typeof setTimeout,
      clearTimeoutFn: vi.fn() as typeof clearTimeout
    });

    listener.start();
    channels[0]?.subscribeCb?.('TIMED_OUT');
    scheduled[0]?.callback();
    await flushAsync();
    await flushAsync();
    channels[1]?.subscribeCb?.('SUBSCRIBED');
    channels[1]?.subscribeCb?.('CHANNEL_ERROR');

    expect(scheduled[1]?.ms).toBe(2000);
  });

  it('CLOSED schedules reconnect unless stopping', async () => {
    const onWakeUp = vi.fn();
    const { client, channels } = createHarness();
    const scheduled: Array<{ callback: () => void; ms: number }> = [];
    const clearTimeoutFn = vi.fn();
    const listener = new SupabaseRealtimeListener({
      onWakeUp,
      client,
      reconnectBaseMs: 2000,
      reconnectMaxMs: 30000,
      jitterRatio: 0,
      setTimeoutFn: ((cb: () => void, ms: number) => {
        scheduled.push({ callback: cb, ms });
        return {} as NodeJS.Timeout;
      }) as typeof setTimeout,
      clearTimeoutFn: clearTimeoutFn as typeof clearTimeout
    });

    listener.start();
    channels[0]?.subscribeCb?.('CLOSED');
    expect(scheduled).toHaveLength(1);
    await listener.stop();
    expect(client.removeChannel).toHaveBeenCalledTimes(0);
  });
});

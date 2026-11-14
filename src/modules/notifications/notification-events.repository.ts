import type { NotificationEvent } from './notification.types.js';
import { getSupabaseAdmin } from '../../config/supabase.js';

type NotificationEventsDb = any;

export type CreateNotificationEventInput = {
  organization_id: string;
  event_type: string;
  source_module: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  idempotency_key: string;
  booking_id?: string | null;
  job_id?: string | null;
  customer_id?: string | null;
  driver_id?: string | null;
  payload: Record<string, unknown>;
};

export class NotificationEventsRepository {
  constructor(private readonly db: NotificationEventsDb = getSupabaseAdmin()) {}

  async createEvent(input: CreateNotificationEventInput): Promise<NotificationEvent> {
    const { data, error } = await this.db
      .from('notification_events')
      .insert({
        organization_id: input.organization_id,
        event_type: input.event_type,
        source_module: input.source_module,
        priority: input.priority ?? 'normal',
        status: 'pending',
        idempotency_key: input.idempotency_key,
        booking_id: input.booking_id ?? null,
        job_id: input.job_id ?? null,
        customer_id: input.customer_id ?? null,
        driver_id: input.driver_id ?? null,
        payload: input.payload
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create notification event: ${error?.message ?? 'unknown error'}`);
    }

    return data as NotificationEvent;
  }

  async getPendingEvents(limit: number): Promise<NotificationEvent[]> {
    return this.getPendingEventsFiltered({ limit });
  }

  /**
   * Fetches due events. Optional type filters support urgent-job capacity reservation
   * so admin campaigns cannot starve Direct/Premium/Open job pushes.
   */
  async getPendingEventsFiltered(input: {
    limit: number;
    includeEventTypes?: string[];
    excludeEventTypes?: string[];
  }): Promise<NotificationEvent[]> {
    const nowIso = new Date().toISOString();
    let query = this.db
      .from('notification_events')
      .select('*')
      .or(
        `status.in.(pending,ready),and(status.eq.failed_retryable,or(next_retry_at.is.null,next_retry_at.lte.${nowIso}))`
      );

    if (input.includeEventTypes && input.includeEventTypes.length > 0) {
      query = query.in('event_type', input.includeEventTypes);
    }
    if (input.excludeEventTypes && input.excludeEventTypes.length > 0) {
      const list = `(${input.excludeEventTypes.map((t) => `"${t}"`).join(',')})`;
      query = query.not('event_type', 'in', list);
    }

    // Priority first (critical→low lexicographically fails: use explicit case via occurred_at
    // secondary). We sort in memory after fetch for stable priority ordering.
    const { data, error } = await query.order('occurred_at', { ascending: true }).limit(Math.max(input.limit * 3, input.limit));

    if (error) {
      throw new Error(`Failed to fetch pending notification events: ${error.message}`);
    }

    const priorityRank: Record<string, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3
    };

    const rows = ((data ?? []) as NotificationEvent[]).sort((a, b) => {
      const pa = priorityRank[a.priority] ?? 2;
      const pb = priorityRank[b.priority] ?? 2;
      if (pa !== pb) {
        return pa - pb;
      }
      return String(a.occurred_at ?? a.created_at).localeCompare(String(b.occurred_at ?? b.created_at));
    });

    return rows.slice(0, input.limit);
  }

  /** After crash/restart: reclaim rows stuck in processing so they are not lost forever. */
  async reclaimStuckProcessing(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data, error } = await this.db
      .from('notification_events')
      .update({
        status: 'pending',
        processing_started_at: null,
        updated_at: new Date().toISOString(),
        guardrail_result: { reclaimed_from: 'processing', reason: 'stuck_processing_timeout' }
      })
      .eq('status', 'processing')
      .lt('processing_started_at', cutoff)
      .select('id');

    if (error) {
      throw new Error(`Failed to reclaim stuck processing events: ${error.message}`);
    }

    return (data ?? []).length;
  }

  /**
   * All due admin push events for an explicit campaign_id (full audience assembly).
   * Caps at `limit` as a safety valve (default 5000).
   */
  async getPendingEventsByCampaignId(campaignId: string, limit = 5000): Promise<NotificationEvent[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('notification_events')
      .select('*')
      .or(
        `status.in.(pending,ready),and(status.eq.failed_retryable,or(next_retry_at.is.null,next_retry_at.lte.${nowIso}))`
      )
      .filter('payload->>campaign_id', 'eq', campaignId)
      .order('occurred_at', { ascending: true })
      .limit(Math.max(1, limit));

    if (error) {
      throw new Error(`Failed to fetch campaign notification events: ${error.message}`);
    }

    return (data ?? []) as NotificationEvent[];
  }

  async mergeEventPayload(eventId: string, patch: Record<string, unknown>): Promise<void> {
    const { data: current, error: loadError } = await this.db
      .from('notification_events')
      .select('payload')
      .eq('id', eventId)
      .single();

    if (loadError || !current) {
      throw new Error(`Failed to load event payload: ${loadError?.message ?? 'unknown error'}`);
    }

    const nextPayload = {
      ...((current.payload as Record<string, unknown> | null) ?? {}),
      ...patch
    };

    const { error } = await this.db
      .from('notification_events')
      .update({
        payload: nextPayload,
        updated_at: new Date().toISOString()
      })
      .eq('id', eventId);

    if (error) {
      throw new Error(`Failed to merge event payload: ${error.message}`);
    }
  }

  async claimEventForProcessing(eventId: string): Promise<NotificationEvent | null> {
    const { data, error } = await this.db
      .from('notification_events')
      .update({
        status: 'processing',
        processing_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', eventId)
      .in('status', ['pending', 'ready', 'failed_retryable'])
      .select('*')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to claim notification event: ${error.message}`);
    }

    return (data as NotificationEvent | null) ?? null;
  }

  async markEventPartiallyDelivered(eventId: string): Promise<void> {
    await this.updateEventStatus(eventId, 'partially_delivered', {
      processed_at: new Date().toISOString()
    });
  }

  async markEventDelivered(eventId: string): Promise<void> {
    await this.updateEventStatus(eventId, 'delivered', {
      processed_at: new Date().toISOString()
    });
  }

  async markEventFailedRetryable(eventId: string, reason: string, nextRetryAt: string): Promise<void> {
    const { data: current, error: loadError } = await this.db
      .from('notification_events')
      .select('retry_count, max_retry_count')
      .eq('id', eventId)
      .single();

    if (loadError || !current) {
      throw new Error(`Failed to load current retry count: ${loadError?.message ?? 'unknown error'}`);
    }

    const nextRetryCount = (current.retry_count ?? 0) + 1;
    const maxRetryCount =
      typeof current.max_retry_count === 'number' && current.max_retry_count > 0
        ? current.max_retry_count
        : 3;

    if (nextRetryCount > maxRetryCount) {
      await this.markEventDeadLetter(
        eventId,
        `Exceeded max_retry_count=${maxRetryCount}: ${reason}`
      );
      return;
    }

    await this.updateEventStatus(eventId, 'failed_retryable', {
      failed_at: new Date().toISOString(),
      guardrail_result: { last_failure_reason: reason },
      next_retry_at: nextRetryAt,
      retry_count: nextRetryCount
    });
  }

  async markEventDeadLetter(eventId: string, reason: string): Promise<void> {
    await this.updateEventStatus(eventId, 'dead_letter', {
      failed_at: new Date().toISOString(),
      dead_letter_reason: reason,
      next_retry_at: null
    });
  }

  async markEventCancelled(eventId: string, reason: string): Promise<void> {
    await this.updateEventStatus(eventId, 'cancelled', {
      next_retry_at: null,
      guardrail_result: { cancelled_reason: reason },
      processed_at: new Date().toISOString()
    });
  }

  private async updateEventStatus(
    eventId: string,
    status: string,
    patch: Record<string, unknown> = {}
  ): Promise<void> {
    const { error } = await this.db
      .from('notification_events')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...patch
      })
      .eq('id', eventId);

    if (error) {
      throw new Error(`Failed to update notification event status: ${error.message}`);
    }
  }
}

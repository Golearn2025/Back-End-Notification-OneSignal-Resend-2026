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
    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('notification_events')
      .select('*')
      .or(
        `status.in.(pending,ready),and(status.eq.failed_retryable,or(next_retry_at.is.null,next_retry_at.lte.${nowIso}))`
      )
      .order('occurred_at', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch pending notification events: ${error.message}`);
    }

    return (data ?? []) as NotificationEvent[];
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
      .select('retry_count')
      .eq('id', eventId)
      .single();

    if (loadError || !current) {
      throw new Error(`Failed to load current retry count: ${loadError?.message ?? 'unknown error'}`);
    }

    await this.updateEventStatus(eventId, 'failed_retryable', {
      failed_at: new Date().toISOString(),
      guardrail_result: { last_failure_reason: reason },
      next_retry_at: nextRetryAt,
      retry_count: (current.retry_count ?? 0) + 1
    });
  }

  async markEventDeadLetter(eventId: string, reason: string): Promise<void> {
    await this.updateEventStatus(eventId, 'dead_letter', {
      failed_at: new Date().toISOString(),
      dead_letter_reason: reason,
      next_retry_at: null
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

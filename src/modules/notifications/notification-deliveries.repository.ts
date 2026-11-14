import type { NotificationDelivery } from './notification.types.js';
import { getSupabaseAdmin } from '../../config/supabase.js';

type NotificationDeliveriesDb = any;

export type CreateNotificationDeliveryInput = {
  organization_id: string;
  event_id: string;
  recipient_type: 'customer' | 'driver' | 'eligible_driver' | 'admin' | 'operator' | 'jobs_mailbox' | 'system';
  recipient_selection:
    | 'specific_customer'
    | 'assigned_driver'
    | 'eligible_drivers'
    | 'org_admins'
    | 'org_operators'
    | 'fixed_mailbox'
    | 'system_generated';
  recipient_id?: string | null;
  recipient_address?: string | null;
  channel: 'in_app' | 'push' | 'email';
  provider: 'notifications_table' | 'onesignal' | 'resend' | 'internal';
  status?: NotificationDelivery['status'];
  max_attempts?: number;
  metadata?: Record<string, unknown>;
};

export class NotificationDeliveriesRepository {
  constructor(private readonly db: NotificationDeliveriesDb = getSupabaseAdmin()) {}

  async createDelivery(input: CreateNotificationDeliveryInput): Promise<NotificationDelivery> {
    const existing = await this.findDelivery(input);
    if (existing) {
      return existing;
    }

    return this.insertDelivery(input);
  }

  /**
   * Batch create with duplicate protection:
   * 1) load existing by event_id list
   * 2) insert only missing rows in one insert
   */
  async createDeliveriesBatch(
    inputs: CreateNotificationDeliveryInput[]
  ): Promise<NotificationDelivery[]> {
    if (inputs.length === 0) {
      return [];
    }

    const eventIds = [...new Set(inputs.map((i) => i.event_id))];
    const { data: existingRows, error: findError } = await this.db
      .from('notification_deliveries')
      .select('*')
      .in('event_id', eventIds)
      .eq('channel', 'push')
      .eq('recipient_type', 'driver');

    if (findError) {
      throw new Error(`Failed to find notification deliveries: ${findError.message}`);
    }

    const existing = (existingRows ?? []) as NotificationDelivery[];
    const byEventId = new Map(existing.map((row) => [row.event_id, row]));
    const missing = inputs.filter((input) => !byEventId.has(input.event_id));

    if (missing.length > 0) {
      const { data: inserted, error: insertError } = await this.db
        .from('notification_deliveries')
        .insert(
          missing.map((input) => ({
            organization_id: input.organization_id,
            event_id: input.event_id,
            recipient_type: input.recipient_type,
            recipient_selection: input.recipient_selection,
            recipient_id: input.recipient_id ?? null,
            recipient_address: input.recipient_address ?? null,
            channel: input.channel,
            provider: input.provider,
            status: input.status ?? 'queued',
            max_attempts: input.max_attempts ?? 3,
            metadata: input.metadata ?? {}
          }))
        )
        .select('*');

      if (insertError) {
        throw new Error(`Failed to create notification deliveries: ${insertError.message}`);
      }

      for (const row of (inserted ?? []) as NotificationDelivery[]) {
        byEventId.set(row.event_id, row);
      }
    }

    return inputs.map((input) => {
      const row = byEventId.get(input.event_id);
      if (!row) {
        throw new Error(`Missing delivery after batch create for event ${input.event_id}`);
      }
      return row;
    });
  }

  async markDeliveriesSending(deliveryIds: string[]): Promise<void> {
    const ids = [...new Set(deliveryIds.filter(Boolean))];
    if (ids.length === 0) {
      return;
    }
    const { error } = await this.db
      .from('notification_deliveries')
      .update({
        status: 'sending',
        updated_at: new Date().toISOString()
      })
      .in('id', ids);

    if (error) {
      throw new Error(`Failed to mark deliveries sending: ${error.message}`);
    }
  }

  async markDeliveriesProviderAccepted(
    deliveryIds: string[],
    providerMessageId: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const ids = [...new Set(deliveryIds.filter(Boolean))];
    if (ids.length === 0) {
      return;
    }
    const { error } = await this.db
      .from('notification_deliveries')
      .update({
        status: 'provider_accepted',
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
        metadata,
        updated_at: new Date().toISOString()
      })
      .in('id', ids);

    if (error) {
      throw new Error(`Failed to mark deliveries provider_accepted: ${error.message}`);
    }
  }

  private async findDelivery(
    input: Pick<
      CreateNotificationDeliveryInput,
      'event_id' | 'recipient_type' | 'recipient_id' | 'recipient_address' | 'channel'
    >
  ): Promise<NotificationDelivery | null> {
    let query = this.db
      .from('notification_deliveries')
      .select('*')
      .eq('event_id', input.event_id)
      .eq('recipient_type', input.recipient_type)
      .eq('channel', input.channel);

    if (input.recipient_id) {
      query = query.eq('recipient_id', input.recipient_id);
    } else if (input.recipient_address) {
      query = query.eq('recipient_address', input.recipient_address);
    } else {
      query = query.is('recipient_id', null).is('recipient_address', null);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(`Failed to find notification delivery: ${error.message}`);
    }

    return (data as NotificationDelivery | null) ?? null;
  }

  private async insertDelivery(input: CreateNotificationDeliveryInput): Promise<NotificationDelivery> {
    const { data, error } = await this.db
      .from('notification_deliveries')
      .insert({
        organization_id: input.organization_id,
        event_id: input.event_id,
        recipient_type: input.recipient_type,
        recipient_selection: input.recipient_selection,
        recipient_id: input.recipient_id ?? null,
        recipient_address: input.recipient_address ?? null,
        channel: input.channel,
        provider: input.provider,
        status: input.status ?? 'queued',
        max_attempts: input.max_attempts ?? 3,
        metadata: input.metadata ?? {}
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create notification delivery: ${error?.message ?? 'unknown error'}`);
    }

    return data as NotificationDelivery;
  }

  async markDeliverySending(deliveryId: string): Promise<void> {
    await this.updateDelivery(deliveryId, {
      status: 'sending'
    });
  }

  async markDeliveryMockSent(deliveryId: string): Promise<void> {
    await this.updateDelivery(deliveryId, {
      status: 'provider_accepted',
      sent_at: new Date().toISOString(),
      delivered_at: new Date().toISOString()
    });
  }

  async markDeliveryProviderAccepted(
    deliveryId: string,
    providerMessageId: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.updateDelivery(deliveryId, {
      status: 'provider_accepted',
      provider_message_id: providerMessageId,
      sent_at: new Date().toISOString(),
      metadata
    });
  }

  async markDeliveryFailedRetryable(
    deliveryId: string,
    reason: string,
    nextRetryAt: string,
    metadataPatch: Record<string, unknown> = {}
  ): Promise<void> {
    const { data: current, error: loadError } = await this.db
      .from('notification_deliveries')
      .select('attempt_no, metadata')
      .eq('id', deliveryId)
      .single();

    if (loadError || !current) {
      throw new Error(`Failed to load current delivery attempt: ${loadError?.message ?? 'unknown error'}`);
    }

    const mergedMetadata = {
      ...((current.metadata as Record<string, unknown> | null) ?? {}),
      ...metadataPatch
    };

    await this.updateDelivery(deliveryId, {
      status: 'failed_retryable',
      attempt_no: (current.attempt_no ?? 0) + 1,
      next_retry_at: nextRetryAt,
      failed_at: new Date().toISOString(),
      provider_error_message: reason,
      metadata: mergedMetadata
    });
  }

  async markDeliveryFailedFinal(deliveryId: string, reason: string): Promise<void> {
    await this.updateDelivery(deliveryId, {
      status: 'failed_final',
      is_dead_letter: true,
      dead_letter_reason: reason,
      failed_at: new Date().toISOString(),
      next_retry_at: null,
      provider_error_message: reason
    });
  }

  private async updateDelivery(deliveryId: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await this.db
      .from('notification_deliveries')
      .update({
        ...patch,
        updated_at: new Date().toISOString()
      })
      .eq('id', deliveryId);

    if (error) {
      throw new Error(`Failed to update notification delivery: ${error.message}`);
    }
  }
}

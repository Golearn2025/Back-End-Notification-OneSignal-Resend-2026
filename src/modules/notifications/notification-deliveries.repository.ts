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

  async markDeliveryFailedRetryable(deliveryId: string, reason: string, nextRetryAt: string): Promise<void> {
    const { data: current, error: loadError } = await this.db
      .from('notification_deliveries')
      .select('attempt_no')
      .eq('id', deliveryId)
      .single();

    if (loadError || !current) {
      throw new Error(`Failed to load current delivery attempt: ${loadError?.message ?? 'unknown error'}`);
    }

    await this.updateDelivery(deliveryId, {
      status: 'failed_retryable',
      attempt_no: (current.attempt_no ?? 0) + 1,
      next_retry_at: nextRetryAt,
      failed_at: new Date().toISOString(),
      provider_error_message: reason
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

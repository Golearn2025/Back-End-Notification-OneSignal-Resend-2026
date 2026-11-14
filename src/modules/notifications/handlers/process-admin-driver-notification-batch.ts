import { logger } from '../../../config/logger.js';
import { getSupabaseAdmin } from '../../../config/supabase.js';
import { OneSignalProvider } from '../../providers/onesignal.provider.js';
import {
  asNonEmptyString,
  getAdminCampaignId,
  isDeliverySucceeded,
  nextRetryAtIso
} from '../notification-shared.js';
import {
  buildPersistedOneSignalPayloadPatch,
  readPersistedOneSignalRequest,
  resolveOneSignalIdempotencyKey,
  type PersistedOneSignalRequest
} from '../onesignal-idempotency.js';
import type { NotificationEvent } from '../notification.types.js';
import type { NotificationDeliveriesRepository } from '../notification-deliveries.repository.js';
import type { NotificationEventsRepository } from '../notification-events.repository.js';

type BatchDeps = {
  events: NotificationEvent[];
  eventsRepository: NotificationEventsRepository;
  deliveriesRepository: NotificationDeliveriesRepository;
  oneSignal?: OneSignalProvider;
  db?: ReturnType<typeof getSupabaseAdmin>;
};

type ResolvedAdminTarget = {
  event: NotificationEvent;
  driverId: string;
  authUserId: string;
  title: string;
  message: string;
  category: string;
  deliveryId: string;
};

/**
 * Admin push batching:
 * - Campaign events share an explicit `payload.campaign_id` → one OneSignal request
 *   with the full prepared audience (inbox/history remain per-driver).
 * - Individual events (no campaign_id) are never merged by title/body — each is its
 *   own send so two intentional same-text campaigns/individuals stay distinct.
 */
export async function processAdminDriverNotificationBatch({
  events,
  eventsRepository,
  deliveriesRepository,
  oneSignal = new OneSignalProvider(),
  db = getSupabaseAdmin()
}: BatchDeps): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const campaignGroups = new Map<string, NotificationEvent[]>();
  const individuals: NotificationEvent[] = [];

  for (const event of events) {
    const campaignId = getAdminCampaignId(event);
    if (campaignId) {
      const bucket = campaignGroups.get(campaignId) ?? [];
      bucket.push(event);
      campaignGroups.set(campaignId, bucket);
    } else {
      individuals.push(event);
    }
  }

  for (const group of campaignGroups.values()) {
    await sendAdminGroup({
      group,
      eventsRepository,
      deliveriesRepository,
      oneSignal,
      db,
      bulk: true
    });
  }

  for (const event of individuals) {
    await sendAdminGroup({
      group: [event],
      eventsRepository,
      deliveriesRepository,
      oneSignal,
      db,
      bulk: false
    });
  }
}

async function sendAdminGroup(input: {
  group: NotificationEvent[];
  eventsRepository: NotificationEventsRepository;
  deliveriesRepository: NotificationDeliveriesRepository;
  oneSignal: OneSignalProvider;
  db: ReturnType<typeof getSupabaseAdmin>;
  bulk: boolean;
}): Promise<void> {
  const { group, eventsRepository, deliveriesRepository, oneSignal, db, bulk } = input;
  const first = group[0];
  if (!first) {
    return;
  }

  const payload = first.payload ?? {};
  const title =
    asNonEmptyString(payload.push_title) ??
    asNonEmptyString(payload.title) ??
    'Notification';
  const message =
    asNonEmptyString(payload.push_body) ??
    asNonEmptyString(payload.message) ??
    asNonEmptyString(payload.body) ??
    '';

  if (!message) {
    for (const event of group) {
      await eventsRepository.markEventFailedRetryable(
        event.id,
        'admin_driver_notification: missing push_body/message',
        nextRetryAtIso()
      );
    }
    return;
  }

  const targets: ResolvedAdminTarget[] = [];

  for (const event of group) {
    const driverId = asNonEmptyString(event.driver_id);
    if (!driverId) {
      await eventsRepository.markEventFailedRetryable(
        event.id,
        'admin_driver_notification: missing driver_id',
        nextRetryAtIso()
      );
      continue;
    }

    const { data: driverAuth, error: driverAuthError } = await db
      .from('drivers')
      .select('auth_user_id')
      .eq('id', driverId)
      .eq('organization_id', event.organization_id)
      .maybeSingle();

    if (driverAuthError) {
      await eventsRepository.markEventFailedRetryable(
        event.id,
        `admin_driver_notification: driver lookup failed: ${driverAuthError.message}`,
        nextRetryAtIso()
      );
      continue;
    }

    const authUserId = asNonEmptyString(
      (driverAuth as { auth_user_id?: string | null } | null)?.auth_user_id ?? undefined
    );
    if (!authUserId) {
      await eventsRepository.markEventFailedRetryable(
        event.id,
        'admin_driver_notification: missing auth_user_id',
        nextRetryAtIso()
      );
      continue;
    }

    const category =
      asNonEmptyString(event.payload?.category) ??
      (event.event_type === 'admin_driver_documents'
        ? 'documents'
        : event.event_type === 'admin_driver_jobs'
          ? 'jobs'
          : 'system');

    const campaignId = getAdminCampaignId(event);
    const delivery = await deliveriesRepository.createDelivery({
      organization_id: event.organization_id,
      event_id: event.id,
      recipient_type: 'driver',
      recipient_selection: 'assigned_driver',
      recipient_id: driverId,
      recipient_address: authUserId,
      channel: 'push',
      provider: 'onesignal',
      status: 'queued',
      max_attempts: 3,
      metadata: {
        event_family: 'admin_communications',
        category,
        push_preview_title: title,
        push_preview_message: message,
        bulk_campaign: bulk,
        ...(campaignId ? { campaign_id: campaignId } : {})
      }
    });

    if (isDeliverySucceeded(delivery.status)) {
      await eventsRepository.markEventDelivered(event.id);
      continue;
    }

    await deliveriesRepository.markDeliverySending(delivery.id);
    targets.push({
      event,
      driverId,
      authUserId,
      title,
      message,
      category,
      deliveryId: delivery.id
    });
  }

  if (targets.length === 0) {
    return;
  }

  const pushData: Record<string, string> = {
    event_type: String(first.event_type),
    category: targets[0]?.category ?? 'system',
    bulk: bulk ? 'true' : 'false'
  };
  const campaignId = getAdminCampaignId(first);
  if (campaignId) {
    pushData.campaign_id = campaignId;
  }

  const persistedFromEvents = group
    .map((e) => readPersistedOneSignalRequest(e.payload))
    .find((p): p is PersistedOneSignalRequest => p != null);

  const liveAudience = [...new Set(targets.map((t) => t.authUserId))].sort();
  const request: PersistedOneSignalRequest = persistedFromEvents ?? {
    idempotency_key: resolveOneSignalIdempotencyKey(
      asNonEmptyString(first.payload?.onesignal_idempotency_key)
    ),
    external_user_ids: liveAudience,
    title,
    message,
    data: pushData
  };

  // Persist UUID + original audience/payload on every event BEFORE the HTTP call
  // so retries never rebuild a different key from the remaining recipient list.
  const payloadPatch = buildPersistedOneSignalPayloadPatch(request);
  for (const event of group) {
    await eventsRepository.mergeEventPayload(event.id, payloadPatch);
    event.payload = { ...(event.payload ?? {}), ...payloadPatch };
  }

  try {
    const { providerMessageId, responseMetadata, idempotencyKey: usedKey } =
      await oneSignal.sendPushToExternalUserIds({
        externalUserIds: request.external_user_ids,
        title: request.title,
        message: request.message,
        ...(request.data ? { data: request.data } : { data: pushData }),
        idempotencyKey: request.idempotency_key
      });
    const invalid = new Set(responseMetadata.invalidExternalIds ?? []);

    for (const target of targets) {
      if (invalid.has(target.authUserId)) {
        await deliveriesRepository.markDeliveryFailedRetryable(
          target.deliveryId,
          `OneSignal invalid_aliases.external_id=${target.authUserId}`,
          nextRetryAtIso(),
          {
            onesignal_idempotency_key: usedKey,
            onesignal_original_audience: request.external_user_ids
          }
        );
        await eventsRepository.markEventFailedRetryable(
          target.event.id,
          `OneSignal invalid alias for ${target.authUserId}`,
          nextRetryAtIso()
        );
        continue;
      }

      try {
        await deliveriesRepository.markDeliveryProviderAccepted(target.deliveryId, providerMessageId, {
          provider: 'onesignal',
          event_type: target.event.event_type,
          category: target.category,
          response_metadata: responseMetadata,
          bulk_recipient_count: request.external_user_ids.length,
          onesignal_idempotency_key: usedKey,
          onesignal_original_audience: request.external_user_ids,
          onesignal_original_title: request.title,
          onesignal_original_message: request.message,
          ...(campaignId ? { campaign_id: campaignId } : {})
        });
        await eventsRepository.markEventDelivered(target.event.id);
      } catch (dbError) {
        const dbReason =
          dbError instanceof Error ? dbError.message : 'Failed to persist provider acceptance';
        await deliveriesRepository.markDeliveryFailedRetryable(
          target.deliveryId,
          `provider_accepted_db_persist_failed:${dbReason}`,
          nextRetryAtIso(),
          {
            onesignal_idempotency_key: usedKey,
            onesignal_original_audience: request.external_user_ids,
            onesignal_original_title: request.title,
            onesignal_original_message: request.message,
            onesignal_original_data: request.data ?? pushData,
            provider_message_id_unpersisted: providerMessageId
          }
        );
        await eventsRepository.markEventFailedRetryable(
          target.event.id,
          `provider_accepted_db_persist_failed;idempotency=${usedKey}`,
          nextRetryAtIso()
        );
        // Ensure event payload still holds the original request for retry.
        await eventsRepository.mergeEventPayload(target.event.id, payloadPatch);
      }
    }

    logger.info(
      {
        bulkSize: request.external_user_ids.length,
        targetsPending: targets.length,
        providerMessageId,
        invalidCount: invalid.size,
        campaignId,
        idempotencyKey: usedKey
      },
      'Admin driver push bulk accepted by OneSignal'
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'OneSignal admin bulk push failed';
    const retryAfterSeconds =
      error && typeof error === 'object' && 'retryAfterSeconds' in error
        ? Number((error as { retryAfterSeconds?: number }).retryAfterSeconds)
        : undefined;
    const permanent =
      error && typeof error === 'object' && 'permanent' in error
        ? Boolean((error as { permanent?: boolean }).permanent)
        : false;
    const keyFromErr =
      error && typeof error === 'object' && 'idempotencyKey' in error
        ? String((error as { idempotencyKey?: string }).idempotencyKey ?? request.idempotency_key)
        : request.idempotency_key;

    for (const target of targets) {
      if (permanent) {
        await deliveriesRepository.markDeliveryFailedFinal(target.deliveryId, reason);
        await eventsRepository.markEventDeadLetter(target.event.id, reason);
      } else {
        await deliveriesRepository.markDeliveryFailedRetryable(
          target.deliveryId,
          reason,
          nextRetryAtIso(retryAfterSeconds),
          {
            onesignal_idempotency_key: keyFromErr,
            onesignal_original_audience: request.external_user_ids,
            onesignal_original_title: request.title,
            onesignal_original_message: request.message,
            onesignal_original_data: request.data ?? pushData
          }
        );
        await eventsRepository.markEventFailedRetryable(
          target.event.id,
          reason,
          nextRetryAtIso(retryAfterSeconds)
        );
        await eventsRepository.mergeEventPayload(target.event.id, payloadPatch);
      }
    }
  }
}

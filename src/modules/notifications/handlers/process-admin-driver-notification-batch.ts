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
import type {
  CreateNotificationDeliveryInput,
  NotificationDeliveriesRepository
} from '../notification-deliveries.repository.js';
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
 * - Individual events (no campaign_id) are never merged by title/body.
 * - Campaign prep uses batched DB ops (lookup/create/claim/payload/accept).
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

  const category =
    asNonEmptyString(first.payload?.category) ??
    (first.event_type === 'admin_driver_documents'
      ? 'documents'
      : first.event_type === 'admin_driver_jobs'
        ? 'jobs'
        : 'system');
  const campaignId = getAdminCampaignId(first);
  const organizationId = first.organization_id;

  const driverIds = group
    .map((e) => asNonEmptyString(e.driver_id))
    .filter((id): id is string => id != null);

  if (driverIds.length === 0) {
    for (const event of group) {
      await eventsRepository.markEventFailedRetryable(
        event.id,
        'admin_driver_notification: missing driver_id',
        nextRetryAtIso()
      );
    }
    return;
  }

  // Batch driver auth lookup (1 query).
  const { data: driverRows, error: driverAuthError } = await db
    .from('drivers')
    .select('id, auth_user_id')
    .eq('organization_id', organizationId)
    .in('id', driverIds);

  if (driverAuthError) {
    for (const event of group) {
      await eventsRepository.markEventFailedRetryable(
        event.id,
        `admin_driver_notification: driver lookup failed: ${driverAuthError.message}`,
        nextRetryAtIso()
      );
    }
    return;
  }

  const authByDriverId = new Map<string, string>();
  for (const row of driverRows ?? []) {
    const id = asNonEmptyString((row as { id?: string }).id);
    const auth = asNonEmptyString((row as { auth_user_id?: string }).auth_user_id);
    if (id && auth) {
      authByDriverId.set(id, auth);
    }
  }

  const deliveryInputs: CreateNotificationDeliveryInput[] = [];
  const prepared: Array<{
    event: NotificationEvent;
    driverId: string;
    authUserId: string;
  }> = [];

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
    const authUserId = authByDriverId.get(driverId);
    if (!authUserId) {
      await eventsRepository.markEventFailedRetryable(
        event.id,
        'admin_driver_notification: missing auth_user_id',
        nextRetryAtIso()
      );
      continue;
    }
    prepared.push({ event, driverId, authUserId });
    deliveryInputs.push({
      organization_id: organizationId,
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
  }

  if (prepared.length === 0) {
    return;
  }

  // Batch delivery create with duplicate protection (find existing + insert missing).
  const deliveries =
    typeof deliveriesRepository.createDeliveriesBatch === 'function'
      ? await deliveriesRepository.createDeliveriesBatch(deliveryInputs)
      : await Promise.all(deliveryInputs.map((input) => deliveriesRepository.createDelivery(input)));
  const targets: ResolvedAdminTarget[] = [];
  const alreadySucceededEventIds: string[] = [];

  for (let i = 0; i < prepared.length; i += 1) {
    const item = prepared[i]!;
    const delivery = deliveries[i]!;
    if (isDeliverySucceeded(delivery.status)) {
      alreadySucceededEventIds.push(item.event.id);
      continue;
    }
    targets.push({
      event: item.event,
      driverId: item.driverId,
      authUserId: item.authUserId,
      title,
      message,
      category,
      deliveryId: delivery.id
    });
  }

  if (alreadySucceededEventIds.length > 0) {
    if (typeof eventsRepository.markEventsDelivered === 'function') {
      await eventsRepository.markEventsDelivered(alreadySucceededEventIds);
    } else {
      for (const id of alreadySucceededEventIds) {
        await eventsRepository.markEventDelivered(id);
      }
    }
  }

  if (targets.length === 0) {
    return;
  }

  if (typeof deliveriesRepository.markDeliveriesSending === 'function') {
    await deliveriesRepository.markDeliveriesSending(targets.map((t) => t.deliveryId));
  } else {
    for (const target of targets) {
      await deliveriesRepository.markDeliverySending(target.deliveryId);
    }
  }

  const pushData: Record<string, string> = {
    event_type: String(first.event_type),
    category,
    bulk: bulk ? 'true' : 'false'
  };
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

  const payloadPatch = buildPersistedOneSignalPayloadPatch(request);
  if (campaignId && typeof eventsRepository.mergeEventPayloadForCampaign === 'function') {
    await eventsRepository.mergeEventPayloadForCampaign(campaignId, payloadPatch);
  } else {
    for (const event of group) {
      await eventsRepository.mergeEventPayload(event.id, payloadPatch);
    }
  }
  for (const event of group) {
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

    const accepted = targets.filter((t) => !invalid.has(t.authUserId));
    const rejected = targets.filter((t) => invalid.has(t.authUserId));

    for (const target of rejected) {
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
    }

    if (accepted.length > 0) {
      const acceptMeta = {
        provider: 'onesignal',
        event_type: first.event_type,
        category,
        response_metadata: responseMetadata,
        bulk_recipient_count: request.external_user_ids.length,
        onesignal_idempotency_key: usedKey,
        onesignal_original_audience: request.external_user_ids,
        onesignal_original_title: request.title,
        onesignal_original_message: request.message,
        ...(campaignId ? { campaign_id: campaignId } : {})
      };

      let batchOk = false;
      if (typeof deliveriesRepository.markDeliveriesProviderAccepted === 'function') {
        try {
          await deliveriesRepository.markDeliveriesProviderAccepted(
            accepted.map((t) => t.deliveryId),
            providerMessageId,
            acceptMeta
          );
          if (typeof eventsRepository.markEventsDelivered === 'function') {
            await eventsRepository.markEventsDelivered(accepted.map((t) => t.event.id));
          } else {
            for (const target of accepted) {
              await eventsRepository.markEventDelivered(target.event.id);
            }
          }
          batchOk = true;
        } catch {
          batchOk = false;
        }
      }

      if (!batchOk) {
        // Per-row fallback: allows partial DB persist failure after provider accept.
        const persistedOk: string[] = [];
        for (const target of accepted) {
          try {
            await deliveriesRepository.markDeliveryProviderAccepted(
              target.deliveryId,
              providerMessageId,
              acceptMeta
            );
            persistedOk.push(target.event.id);
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
          }
        }
        if (persistedOk.length > 0) {
          if (typeof eventsRepository.markEventsDelivered === 'function') {
            await eventsRepository.markEventsDelivered(persistedOk);
          } else {
            for (const id of persistedOk) {
              await eventsRepository.markEventDelivered(id);
            }
          }
        }
        if (persistedOk.length < accepted.length && campaignId) {
          if (typeof eventsRepository.mergeEventPayloadForCampaign === 'function') {
            await eventsRepository.mergeEventPayloadForCampaign(campaignId, payloadPatch);
          }
        }
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
      }
    }
    if (campaignId && typeof eventsRepository.mergeEventPayloadForCampaign === 'function') {
      await eventsRepository.mergeEventPayloadForCampaign(campaignId, payloadPatch);
    }
  }
}

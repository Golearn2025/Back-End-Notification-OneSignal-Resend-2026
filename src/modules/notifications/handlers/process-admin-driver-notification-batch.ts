import { logger } from '../../../config/logger.js';
import { getSupabaseAdmin } from '../../../config/supabase.js';
import { OneSignalProvider } from '../../providers/onesignal.provider.js';
import {
  adminPushFingerprint,
  asNonEmptyString,
  isDeliverySucceeded,
  nextRetryAtIso
} from '../notification-shared.js';
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
 * Groups admin_driver_* events that share org + title + body into one OneSignal call
 * while keeping per-driver delivery rows and partial-failure semantics.
 * Events with unique content still fall back to the single-recipient handler.
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

  const groups = new Map<string, NotificationEvent[]>();
  for (const event of events) {
    const payload = event.payload ?? {};
    const title =
      asNonEmptyString(payload.push_title) ??
      asNonEmptyString(payload.title) ??
      'Notification';
    const message =
      asNonEmptyString(payload.push_body) ??
      asNonEmptyString(payload.message) ??
      asNonEmptyString(payload.body) ??
      '';
    const key = adminPushFingerprint({
      organizationId: event.organization_id,
      eventType: event.event_type,
      title,
      message
    });
    const bucket = groups.get(key) ?? [];
    bucket.push(event);
    groups.set(key, bucket);
  }

  // Always use sendAdminGroup (incl. size 1) so injected db/oneSignal are honored in tests
  // and production batching stays consistent.
  for (const group of groups.values()) {
    await sendAdminGroup({
      group,
      eventsRepository,
      deliveriesRepository,
      oneSignal,
      db
    });
  }
}

async function sendAdminGroup(input: {
  group: NotificationEvent[];
  eventsRepository: NotificationEventsRepository;
  deliveriesRepository: NotificationDeliveriesRepository;
  oneSignal: OneSignalProvider;
  db: ReturnType<typeof getSupabaseAdmin>;
}): Promise<void> {
  const { group, eventsRepository, deliveriesRepository, oneSignal, db } = input;
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
        bulk_campaign: true
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

  try {
    const { providerMessageId, responseMetadata } = await oneSignal.sendPushToExternalUserIds({
      externalUserIds: targets.map((t) => t.authUserId),
      title,
      message,
      data: {
        event_type: first.event_type,
        category: targets[0]?.category ?? 'system',
        bulk: 'true'
      }
    });
    const invalid = new Set(responseMetadata.invalidExternalIds ?? []);

    for (const target of targets) {
      if (invalid.has(target.authUserId)) {
        await deliveriesRepository.markDeliveryFailedRetryable(
          target.deliveryId,
          `OneSignal invalid_aliases.external_id=${target.authUserId}`,
          nextRetryAtIso()
        );
        await eventsRepository.markEventFailedRetryable(
          target.event.id,
          `OneSignal invalid alias for ${target.authUserId}`,
          nextRetryAtIso()
        );
        continue;
      }

      await deliveriesRepository.markDeliveryProviderAccepted(target.deliveryId, providerMessageId, {
        provider: 'onesignal',
        event_type: target.event.event_type,
        category: target.category,
        response_metadata: responseMetadata,
        bulk_recipient_count: targets.length
      });
      await eventsRepository.markEventDelivered(target.event.id);
    }

    logger.info(
      {
        bulkSize: targets.length,
        providerMessageId,
        invalidCount: invalid.size
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

    for (const target of targets) {
      if (permanent) {
        await deliveriesRepository.markDeliveryFailedFinal(target.deliveryId, reason);
        await eventsRepository.markEventDeadLetter(target.event.id, reason);
      } else {
        await deliveriesRepository.markDeliveryFailedRetryable(
          target.deliveryId,
          reason,
          nextRetryAtIso(retryAfterSeconds)
        );
        await eventsRepository.markEventFailedRetryable(
          target.event.id,
          reason,
          nextRetryAtIso(retryAfterSeconds)
        );
      }
    }
  }
}

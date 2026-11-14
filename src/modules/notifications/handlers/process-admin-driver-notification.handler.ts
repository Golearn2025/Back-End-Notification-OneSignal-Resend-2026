import { logger } from '../../../config/logger.js';
import { getSupabaseAdmin } from '../../../config/supabase.js';
import { OneSignalProvider } from '../../providers/onesignal.provider.js';
import {
  asNonEmptyString,
  isDeliverySucceeded,
  nextRetryAtIso
} from '../notification-shared.js';
import type { NotificationEvent } from '../notification.types.js';
import type { NotificationDeliveriesRepository } from '../notification-deliveries.repository.js';
import type { NotificationEventsRepository } from '../notification-events.repository.js';

const ADMIN_EVENT_TYPES = new Set([
  'admin_driver_system',
  'admin_driver_documents',
  'admin_driver_jobs'
]);

export function isAdminDriverNotificationEventType(eventType: string): boolean {
  return ADMIN_EVENT_TYPES.has(eventType);
}

type AdminHandlerDeps = {
  event: NotificationEvent;
  eventsRepository: NotificationEventsRepository;
  deliveriesRepository: NotificationDeliveriesRepository;
};

/**
 * Admin Communications → driver push.
 * Title/body come from payload.push_title / push_body (already set by admin enqueue RPC).
 * Inbox row is written by admin_enqueue_driver_notification; this handler only does push.
 */
export async function processAdminDriverNotification({
  event,
  eventsRepository,
  deliveriesRepository
}: AdminHandlerDeps): Promise<void> {
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

  const driverId = asNonEmptyString(event.driver_id);
  if (!driverId) {
    await eventsRepository.markEventFailedRetryable(
      event.id,
      'admin_driver_notification: missing driver_id',
      nextRetryAtIso()
    );
    return;
  }

  if (!message) {
    await eventsRepository.markEventFailedRetryable(
      event.id,
      'admin_driver_notification: missing push_body/message',
      nextRetryAtIso()
    );
    return;
  }

  const db = getSupabaseAdmin();
  const { data: driverAuth, error: driverAuthError } = await db
    .from('drivers')
    .select('auth_user_id')
    .eq('id', driverId)
    .eq('organization_id', event.organization_id)
    .maybeSingle();

  if (driverAuthError) {
    throw new Error(`admin_driver_notification: driver lookup failed: ${driverAuthError.message}`);
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
    return;
  }

  const category =
    asNonEmptyString(payload.category) ??
    (event.event_type === 'admin_driver_documents'
      ? 'documents'
      : event.event_type === 'admin_driver_jobs'
        ? 'jobs'
        : 'system');

  const pushDelivery = await deliveriesRepository.createDelivery({
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
      push_preview_message: message
    }
  });

  if (isDeliverySucceeded(pushDelivery.status)) {
    await eventsRepository.markEventDelivered(event.id);
    return;
  }

  const oneSignal = new OneSignalProvider();
  await deliveriesRepository.markDeliverySending(pushDelivery.id);

  try {
    const { providerMessageId, responseMetadata } = await oneSignal.sendPushToExternalUserId({
      externalUserId: authUserId,
      title,
      message,
      data: (() => {
        const data: Record<string, string> = {
          event_type: event.event_type,
          category,
          driver_id: driverId
        };
        const inboxType = asNonEmptyString(payload.inbox_type);
        const deepLink = asNonEmptyString(payload.deep_link);
        const jobId =
          asNonEmptyString(event.job_id) ?? asNonEmptyString(payload.job_id);
        const documentType = asNonEmptyString(payload.document_type);
        const daysLeft =
          typeof payload.days_left === 'number'
            ? String(payload.days_left)
            : asNonEmptyString(payload.days_left);
        if (inboxType) data.inbox_type = inboxType;
        if (deepLink) data.deep_link = deepLink;
        if (jobId) data.job_id = jobId;
        if (documentType) data.document_type = documentType;
        if (daysLeft) data.days_left = daysLeft;
        return data;
      })()
    });

    await deliveriesRepository.markDeliveryProviderAccepted(pushDelivery.id, providerMessageId, {
      provider: 'onesignal',
      event_type: event.event_type,
      category,
      response_metadata: responseMetadata
    });
    await eventsRepository.markEventDelivered(event.id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'OneSignal admin_driver push failed';
    await deliveriesRepository.markDeliveryFailedRetryable(
      pushDelivery.id,
      reason,
      nextRetryAtIso()
    );
    await eventsRepository.markEventFailedRetryable(event.id, reason, nextRetryAtIso());
    logger.warn({ eventId: event.id, err: reason }, 'admin_driver_notification push failed');
  }
}

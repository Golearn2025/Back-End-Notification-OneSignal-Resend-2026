import { logger } from '../../../config/logger.js';
import { getSupabaseAdmin } from '../../../config/supabase.js';
import { OneSignalProvider } from '../../providers/onesignal.provider.js';
import { buildDriverPushMessage, formatPayout } from '../driver-push.formatter.js';
import { loadBookingNotificationContext } from '../booking-notification-context.service.js';
import { DriverEligibilityService } from '../driver-eligibility.service.js';
import { asNonEmptyString, nextRetryAtIso } from '../notification-shared.js';
import type { HandlerDeps } from './handler-deps.js';

export async function processDriverJobAvailable(
  {
    event,
    eventsRepository,
    deliveriesRepository
  }: Omit<HandlerDeps, 'resend'>,
  deps: {
    oneSignal?: OneSignalProvider;
    driverEligibilityService?: DriverEligibilityService;
    db?: ReturnType<typeof getSupabaseAdmin>;
  } = {}
): Promise<void> {
  const oneSignal = deps.oneSignal ?? new OneSignalProvider();
  const driverEligibilityService = deps.driverEligibilityService ?? new DriverEligibilityService();
  const db = deps.db ?? getSupabaseAdmin();
  const organizationId = event.organization_id;
  const bookingReference = asNonEmptyString(event.payload.booking_reference) ?? 'New booking';
  const vehicleCategoryId = asNonEmptyString(event.payload.vehicle_category_id);
  const vehicleModelId = asNonEmptyString(event.payload.vehicle_model_id);
  const bookingType = asNonEmptyString(event.payload.booking_type);
  const pickupAddress = asNonEmptyString(event.payload.pickup_address) ?? '';
  const dropoffAddress = asNonEmptyString(event.payload.dropoff_address) ?? '';
  const scheduledAt = asNonEmptyString(event.payload.scheduled_at) ?? '';
  const bookingLegId = asNonEmptyString(event.payload.job_id);
  const bookingId = asNonEmptyString(event.payload.booking_id);

  const bookingContext =
    bookingId == null
      ? {
          legKind: null,
          legNumber: null,
          hoursRequested: null,
          daysRequested: null,
          fleetTotalLegs: null
        }
      : await loadBookingNotificationContext(db, {
          organizationId,
          bookingId,
          bookingLegId,
          bookingType
        });

  // Anti-spam: for fleet we notify only the first leg in the booking.
  if (bookingType === 'fleet' && bookingContext.legNumber != null && bookingContext.legNumber > 1) {
    logger.info(
      { eventId: event.id, bookingLegId, bookingId, legNumber: bookingContext.legNumber },
      'Skipping fleet leg push to prevent multi-leg notification spam'
    );
    await eventsRepository.markEventDelivered(event.id);
    return;
  }

  let payoutDisplay: string | null = null;
  if (bookingLegId) {
    try {
      const financial = await driverEligibilityService.getLatestLegFinancial({ bookingLegId });
      payoutDisplay = formatPayout(financial.driverPayoutPence, financial.currency);
    } catch (error) {
      logger.warn(
        { eventId: event.id, error: error instanceof Error ? error.message : 'unknown error' },
        'Failed to load leg financials for driver push'
      );
    }
  }

  const defaultPush = buildDriverPushMessage({
    bookingReference,
    bookingType,
    pickupAddress,
    dropoffAddress,
    scheduledAt,
    vehicleCategoryId,
    vehicleModelId,
    payoutDisplay,
    legKind: bookingContext.legKind,
    legNumber: bookingContext.legNumber,
    hoursRequested: bookingContext.hoursRequested,
    daysRequested: bookingContext.daysRequested,
    fleetTotalLegs: bookingContext.fleetTotalLegs
  });
  const title = asNonEmptyString(event.payload.push_title) ?? defaultPush.title;
  const message = asNonEmptyString(event.payload.push_message) ?? defaultPush.message;

  let eligibleDrivers: Array<{ driverId: string; authUserId: string }>;
  try {
    eligibleDrivers = await driverEligibilityService.resolveEligibleDrivers({
      organizationId,
      vehicleCategoryId,
      vehicleModelId
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Failed to load eligible drivers';
    await eventsRepository.markEventFailedRetryable(event.id, reason, nextRetryAtIso());
    return;
  }

  if (eligibleDrivers.length === 0) {
    logger.info({ eventId: event.id, eventType: event.event_type }, 'No eligible drivers for push');
    await eventsRepository.markEventDelivered(event.id);
    return;
  }

  const authUserIds = eligibleDrivers.map((item) => item.authUserId);
  let activeExternalIds: Set<string>;
  try {
    activeExternalIds = await driverEligibilityService.resolveActiveExternalUserIds({
      organizationId,
      authUserIds
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Failed to load push subscriptions';
    await eventsRepository.markEventFailedRetryable(event.id, reason, nextRetryAtIso());
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (const driver of eligibleDrivers) {
    if (!activeExternalIds.has(driver.authUserId)) {
      continue;
    }

    const delivery = await deliveriesRepository.createDelivery({
      organization_id: organizationId,
      event_id: event.id,
      recipient_type: 'eligible_driver',
      recipient_selection: 'eligible_drivers',
      recipient_id: driver.driverId,
      recipient_address: driver.authUserId,
      channel: 'push',
      provider: 'onesignal',
      status: 'queued',
      max_attempts: 3,
      metadata: {
        event_family: 'driver_job',
        booking_reference: bookingReference,
        vehicle_model_id: vehicleModelId,
        vehicle_category_id: vehicleCategoryId,
        push_preview_title: title,
        push_preview_message: message
      }
    });

    await deliveriesRepository.markDeliverySending(delivery.id);
    try {
      const { providerMessageId, responseMetadata } = await oneSignal.sendPushToExternalUserId({
        externalUserId: driver.authUserId,
        title,
        message
      });
      await deliveriesRepository.markDeliveryProviderAccepted(delivery.id, providerMessageId, {
        provider: 'onesignal',
        event_type: 'driver_job_available',
        response_metadata: responseMetadata,
        booking_reference: bookingReference
      });
      successCount += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'OneSignal push send failed';
      await deliveriesRepository.markDeliveryFailedRetryable(delivery.id, reason, nextRetryAtIso());
      failCount += 1;
    }
  }

  if (successCount > 0 && failCount === 0) {
    await eventsRepository.markEventDelivered(event.id);
    return;
  }

  if (successCount > 0 && failCount > 0) {
    await eventsRepository.markEventPartiallyDelivered(event.id);
    return;
  }

  const reason = failCount > 0 ? 'All driver push deliveries failed' : 'No active push subscription';
  await eventsRepository.markEventFailedRetryable(event.id, reason, nextRetryAtIso());
}

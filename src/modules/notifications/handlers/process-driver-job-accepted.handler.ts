import { logger } from '../../../config/logger.js';
import { getSupabaseAdmin } from '../../../config/supabase.js';
import { OneSignalProvider } from '../../providers/onesignal.provider.js';
import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  DRIVER_JOB_ACCEPTED_TEMPLATE_ALIAS,
  asNonEmptyString,
  nextRetryAtIso
} from '../notification-shared.js';
import { loadBookingNotificationContext } from '../booking-notification-context.service.js';
import { buildDriverJobAcceptedPushMessage, formatPayout } from '../driver-push.formatter.js';
import type { HandlerDeps } from './handler-deps.js';

type DriverJobAcceptedRow = {
  job_id: string;
  booking_id: string;
  organization_id: string;
  driver_id: string;
  booking_reference: string | null;
  booking_type: string | null;
  leg_number: number | null;
  leg_kind: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  scheduled_at: string | null;
  passenger_count: number | null;
  bag_count: number | null;
  vehicle_category_id: string | null;
  vehicle_model_id: string | null;
  driver_payout_pence: number | null;
  payout_currency: string | null;
  driver_first_name: string | null;
  driver_last_name: string | null;
  driver_email: string | null;
};

export async function processDriverJobAccepted(
  { event, eventsRepository, deliveriesRepository, resend }: HandlerDeps,
  deps: { oneSignal?: OneSignalProvider; db?: ReturnType<typeof getSupabaseAdmin> } = {}
): Promise<void> {
  const db = deps.db ?? getSupabaseAdmin();
  const oneSignal = deps.oneSignal ?? new OneSignalProvider();

  const jobId =
    asNonEmptyString(event.job_id) ??
    asNonEmptyString(event.payload.job_id) ??
    asNonEmptyString((event.payload as { booking_leg_id?: unknown }).booking_leg_id);

  if (!jobId) {
    await eventsRepository.markEventFailedRetryable(
      event.id,
      'Missing job_id on notification event for driver_job_accepted',
      nextRetryAtIso()
    );
    return;
  }

  const { data: row, error: viewError } = await db
    .from('driver_jobs_accepted_v1')
    .select('*')
    .eq('job_id', jobId)
    .eq('organization_id', event.organization_id)
    .maybeSingle();

  if (viewError) {
    await eventsRepository.markEventFailedRetryable(
      event.id,
      `driver_jobs_accepted_v1 query failed: ${viewError.message}`,
      nextRetryAtIso()
    );
    return;
  }

  if (!row) {
    await eventsRepository.markEventFailedRetryable(
      event.id,
      `No row in driver_jobs_accepted_v1 for job_id=${jobId} org=${event.organization_id}`,
      nextRetryAtIso()
    );
    return;
  }

  const v = row as DriverJobAcceptedRow;
  const driverEmail = asNonEmptyString(v.driver_email);
  const payoutDisplay = formatPayout(
    typeof v.driver_payout_pence === 'number' ? v.driver_payout_pence : null,
    asNonEmptyString(v.payout_currency)
  );

  const { data: driverAuth, error: driverErr } = await db
    .from('drivers')
    .select('auth_user_id')
    .eq('id', v.driver_id)
    .eq('organization_id', v.organization_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (driverErr) {
    await eventsRepository.markEventFailedRetryable(
      event.id,
      `drivers lookup failed: ${driverErr.message}`,
      nextRetryAtIso()
    );
    return;
  }

  const authRow = driverAuth as { auth_user_id?: string | null } | null;
  const authUserId = asNonEmptyString(authRow?.auth_user_id ?? undefined);
  const bookingContext = await loadBookingNotificationContext(db, {
    organizationId: v.organization_id,
    bookingId: v.booking_id,
    bookingLegId: v.job_id,
    bookingType: v.booking_type
  });

  let emailAttempted = false;
  let emailOk = false;
  let pushAttempted = false;
  let pushOk = false;

  if (driverEmail) {
    emailAttempted = true;
    const emailDelivery = await deliveriesRepository.createDelivery({
      organization_id: event.organization_id,
      event_id: event.id,
      recipient_type: 'driver',
      recipient_selection: 'assigned_driver',
      recipient_id: v.driver_id,
      recipient_address: driverEmail,
      channel: 'email',
      provider: 'resend',
      status: 'queued',
      max_attempts: 3,
      metadata: {
        template_alias: DRIVER_JOB_ACCEPTED_TEMPLATE_ALIAS,
        template_version: 'v1',
        render_mode: 'resend_template',
        reply_to: DEFAULT_SUPPORT_EMAIL,
        event_family: 'driver_job',
        job_id: v.job_id
      }
    });

    await deliveriesRepository.markDeliverySending(emailDelivery.id);
    try {
      const { providerMessageId } = await resend.sendDriverJobAcceptedEmail({
        to: driverEmail,
        driverFirstName: asNonEmptyString(v.driver_first_name) ?? 'there',
        bookingReference: asNonEmptyString(v.booking_reference) ?? '—',
        pickupAddress: asNonEmptyString(v.pickup_address) ?? '',
        dropoffAddress: asNonEmptyString(v.dropoff_address) ?? '',
        scheduledAt: formatScheduledAtForEmail(v.scheduled_at),
        passengerCount: v.passenger_count ?? '',
        bagCount: v.bag_count ?? '',
        bookingType: v.booking_type != null ? String(v.booking_type) : '',
        vehicleCategoryId: asNonEmptyString(v.vehicle_category_id) ?? '',
        vehicleModelId: asNonEmptyString(v.vehicle_model_id) ?? '',
        legKind: bookingContext.legKind ?? asNonEmptyString(v.leg_kind) ?? '',
        legNumber:
          typeof bookingContext.legNumber === 'number'
            ? bookingContext.legNumber
            : typeof v.leg_number === 'number'
              ? v.leg_number
              : null,
        hoursRequested: bookingContext.hoursRequested,
        daysRequested: bookingContext.daysRequested,
        fleetTotalLegs: bookingContext.fleetTotalLegs,
        driverPayoutPence: typeof v.driver_payout_pence === 'number' ? v.driver_payout_pence : null,
        payoutCurrency: asNonEmptyString(v.payout_currency) ?? 'GBP',
        driverPayoutDisplay: payoutDisplay ?? '—',
        supportEmail: DEFAULT_SUPPORT_EMAIL,
        supportPhone: DEFAULT_SUPPORT_PHONE
      });

      await deliveriesRepository.markDeliveryProviderAccepted(emailDelivery.id, providerMessageId, {
        provider: 'resend',
        event_type: 'driver_job_accepted',
        template_alias: DRIVER_JOB_ACCEPTED_TEMPLATE_ALIAS,
        template_version: 'v1',
        render_mode: 'resend_template',
        reply_to: DEFAULT_SUPPORT_EMAIL,
        event_family: 'driver_job',
        job_id: v.job_id
      });
      emailOk = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Resend driver_job_accepted failed';
      await deliveriesRepository.markDeliveryFailedRetryable(emailDelivery.id, reason, nextRetryAtIso());
      logger.warn({ eventId: event.id, err: reason }, 'driver_job_accepted email failed');
    }
  } else {
    logger.warn({ eventId: event.id, jobId }, 'driver_job_accepted: missing driver_email; skipping email');
  }

  if (authUserId) {
    pushAttempted = true;
    const pushInput = {
      bookingReference: asNonEmptyString(v.booking_reference) ?? 'Booking',
      bookingType: v.booking_type != null ? String(v.booking_type) : null,
      pickupAddress: asNonEmptyString(v.pickup_address) ?? '',
      dropoffAddress: asNonEmptyString(v.dropoff_address) ?? '',
      scheduledAt: v.scheduled_at,
      vehicleCategoryId: asNonEmptyString(v.vehicle_category_id),
      vehicleModelId: asNonEmptyString(v.vehicle_model_id),
      payoutDisplay,
      legKind: bookingContext.legKind ?? asNonEmptyString(v.leg_kind),
      legNumber:
        typeof bookingContext.legNumber === 'number'
          ? bookingContext.legNumber
          : typeof v.leg_number === 'number'
            ? v.leg_number
            : null,
      hoursRequested: bookingContext.hoursRequested,
      daysRequested: bookingContext.daysRequested,
      fleetTotalLegs: bookingContext.fleetTotalLegs
    };
    const { title, message } = buildDriverJobAcceptedPushMessage(pushInput);

    const pushDelivery = await deliveriesRepository.createDelivery({
      organization_id: event.organization_id,
      event_id: event.id,
      recipient_type: 'driver',
      recipient_selection: 'assigned_driver',
      recipient_id: v.driver_id,
      recipient_address: authUserId,
      channel: 'push',
      provider: 'onesignal',
      status: 'queued',
      max_attempts: 3,
      metadata: {
        event_family: 'driver_job',
        booking_reference: asNonEmptyString(v.booking_reference),
        push_preview_title: title,
        push_preview_message: message,
        job_id: v.job_id
      }
    });

    await deliveriesRepository.markDeliverySending(pushDelivery.id);
    try {
      const { providerMessageId, responseMetadata } = await oneSignal.sendPushToExternalUserId({
        externalUserId: authUserId,
        title,
        message
      });
      await deliveriesRepository.markDeliveryProviderAccepted(pushDelivery.id, providerMessageId, {
        provider: 'onesignal',
        event_type: 'driver_job_accepted',
        response_metadata: responseMetadata,
        job_id: v.job_id
      });
      pushOk = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'OneSignal driver_job_accepted push failed';
      await deliveriesRepository.markDeliveryFailedRetryable(pushDelivery.id, reason, nextRetryAtIso());
      logger.warn({ eventId: event.id, err: reason }, 'driver_job_accepted push failed');
    }
  } else {
    logger.warn({ eventId: event.id, driverId: v.driver_id }, 'driver_job_accepted: missing auth_user_id; skipping push');
  }

  if (!emailAttempted && !pushAttempted) {
    await eventsRepository.markEventFailedRetryable(
      event.id,
      'driver_job_accepted: no driver_email and no auth_user_id for push',
      nextRetryAtIso()
    );
    return;
  }

  if (!emailOk && !pushOk) {
    await eventsRepository.markEventFailedRetryable(
      event.id,
      'driver_job_accepted: all attempted channels failed',
      nextRetryAtIso()
    );
    return;
  }

  if (emailAttempted && pushAttempted) {
    if (emailOk && pushOk) {
      await eventsRepository.markEventDelivered(event.id);
    } else {
      await eventsRepository.markEventPartiallyDelivered(event.id);
    }
    return;
  }

  await eventsRepository.markEventDelivered(event.id);
}

function formatScheduledAtForEmail(value: string | null): string {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

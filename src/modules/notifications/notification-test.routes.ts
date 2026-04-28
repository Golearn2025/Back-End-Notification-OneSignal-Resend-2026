import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotificationEventsRepository } from './notification-events.repository.js';
import { NotificationDeliveriesRepository } from './notification-deliveries.repository.js';
import { PushSubscriptionResolverService } from './push-subscription-resolver.service.js';
import { OneSignalProvider } from '../providers/onesignal.provider.js';
import { logger } from '../../config/logger.js';
import { getEnv } from '../../config/env.js';
import { getSupabaseAdmin } from '../../config/supabase.js';

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerEmail: z.string().email(),
  customerFirstName: z.string().min(1)
});

const oneSignalDriverPushBodySchema = z.object({
  organizationId: z.string().uuid(),
  driverId: z.string().uuid(),
  title: z.string().min(1),
  message: z.string().min(1)
});

const paymentSuccessCustomerBodySchema = z
  .object({
    bookingId: z.string().uuid().optional(),
    bookingReference: z.string().min(1).optional(),
    customerEmailOverride: z.string().email().optional()
  })
  .refine((value) => value.bookingId || value.bookingReference, {
    message: 'bookingId or bookingReference is required'
  });

type PaymentContextRow = {
  organization_id: string;
  booking_id: string;
  customer_id: string | null;
  customer_first_name: string | null;
  customer_email: string | null;
  booking_reference: string;
  booking_type: string;
  passenger_count: number | null;
  bag_count: number | null;
  hours_requested: number | null;
  days_requested: number | null;
  first_scheduled_at: string | null;
  return_scheduled_at: string | null;
  legs_json: unknown;
  fleet_vehicle_count: number | null;
  fleet_category_summary: string | null;
  amount_pence: number | null;
  amount_formatted: string | null;
  currency: string | null;
  payment_date: string | null;
  invoice_number: string | null;
  receipt_url: string | null;
  payment_method_raw_or_metadata: string | null;
  vehicle_category_id: string | null;
  vehicle_model_id: string | null;
  trip_configuration_raw: Record<string, unknown> | null;
};

type BookingLine = { label: string; value: string };

type LegEntry = {
  leg_number?: number;
  pickup_address?: string;
  dropoff_address?: string;
  scheduled_at?: string;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatDateTime(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRoute(pickup: string | undefined, dropoff: string | undefined): string {
  const from = asNonEmptyString(pickup) ?? 'Unknown pickup';
  const to = asNonEmptyString(dropoff) ?? 'Unknown dropoff';
  return `${from} -> ${to}`;
}

function pickLeg(legs: LegEntry[], legNumber: number): LegEntry | null {
  return legs.find((leg) => leg.leg_number === legNumber) ?? null;
}

function parseLegs(value: unknown): LegEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => typeof entry === 'object' && entry !== null)
    .map((entry) => entry as LegEntry)
    .sort((a, b) => (a.leg_number ?? 999) - (b.leg_number ?? 999));
}

function formatAmount(amountPence: number | null, currency: string | null): string | null {
  if (typeof amountPence !== 'number' || !currency) {
    return null;
  }
  return `${currency} ${(amountPence / 100).toFixed(2)}`;
}

function normalizePaymentMethod(raw: string | null): string {
  if (!raw) {
    return 'Payment confirmed';
  }
  if (raw.toLowerCase() === 'full') {
    return 'Paid in full';
  }
  return raw;
}

export function buildBookingLines(context: PaymentContextRow): BookingLine[] {
  const legs = parseLegs(context.legs_json);
  const leg1 = pickLeg(legs, 1) ?? legs[0] ?? null;
  const leg2 = pickLeg(legs, 2) ?? legs[1] ?? null;
  const type = context.booking_type;
  const firstWhen = formatDateTime(context.first_scheduled_at) ?? 'Pending confirmation';

  if (type === 'oneway') {
    return [
      { label: 'Booking Type', value: 'One Way' },
      { label: 'Reference', value: context.booking_reference },
      { label: 'When', value: firstWhen },
      {
        label: 'Route',
        value: formatRoute(leg1?.pickup_address, leg1?.dropoff_address)
      },
      {
        label: 'Vehicle',
        value: context.vehicle_model_id ?? context.vehicle_category_id ?? 'To be assigned'
      },
      {
        label: 'Passengers/Luggage',
        value: `${context.passenger_count ?? 0} / ${context.bag_count ?? 0}`
      }
    ];
  }

  if (type === 'return') {
    const outboundTime = formatDateTime(leg1?.scheduled_at) ?? firstWhen;
    const returnTime = formatDateTime(context.return_scheduled_at) ?? 'Pending confirmation';
    return [
      { label: 'Booking Type', value: 'Return' },
      { label: 'Reference', value: context.booking_reference },
      {
        label: 'Outbound',
        value: formatRoute(leg1?.pickup_address, leg1?.dropoff_address)
      },
      { label: 'Outbound Time', value: outboundTime },
      {
        label: 'Return',
        value: leg2
          ? formatRoute(leg2.pickup_address, leg2.dropoff_address)
          : 'Return segment pending confirmation'
      },
      { label: 'Return Time', value: returnTime }
    ];
  }

  if (type === 'hourly') {
    const hours = context.hours_requested ?? Number(context.trip_configuration_raw?.hours ?? 0);
    return [
      { label: 'Booking Type', value: 'Hourly' },
      { label: 'Reference', value: context.booking_reference },
      { label: 'Start', value: firstWhen },
      { label: 'Pickup', value: asNonEmptyString(leg1?.pickup_address) ?? 'Unknown pickup' },
      { label: 'Duration', value: `${hours || 0} hours` },
      {
        label: 'Vehicle',
        value: context.vehicle_model_id ?? context.vehicle_category_id ?? 'To be assigned'
      }
    ];
  }

  if (type === 'daily') {
    const days = context.days_requested ?? Number(context.trip_configuration_raw?.days ?? 0);
    return [
      { label: 'Booking Type', value: 'Daily' },
      { label: 'Reference', value: context.booking_reference },
      { label: 'Start', value: firstWhen },
      { label: 'Duration', value: `${days || 0} days` },
      {
        label: 'Route',
        value: formatRoute(leg1?.pickup_address, leg1?.dropoff_address)
      },
      {
        label: 'Vehicle',
        value: context.vehicle_model_id ?? context.vehicle_category_id ?? 'To be assigned'
      }
    ];
  }

  const baseServiceType = asNonEmptyString(context.trip_configuration_raw?.baseServiceType);
  return [
    { label: 'Booking Type', value: 'Fleet' },
    { label: 'Reference', value: context.booking_reference },
    { label: 'Start', value: firstWhen },
    { label: 'Vehicles', value: String(context.fleet_vehicle_count ?? 0) },
    { label: 'Fleet', value: context.fleet_category_summary ?? 'Fleet details pending' },
    { label: 'Service', value: baseServiceType ?? 'Fleet booking' }
  ];
}

export async function registerNotificationTestRoutes(app: FastifyInstance) {
  app.post('/notifications/test/customer-account-created', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: parsed.error.flatten().fieldErrors
      });
    }

    const { organizationId, customerId, customerEmail, customerFirstName } = parsed.data;
    const nowIso = new Date().toISOString();
    const eventsRepository = new NotificationEventsRepository();

    const event = await eventsRepository.createEvent({
      organization_id: organizationId,
      event_type: 'customer_account_created',
      source_module: 'identity',
      priority: 'normal',
      idempotency_key: `customer_account_created:${organizationId}:${customerId}:${nowIso}`,
      customer_id: customerId,
      payload: {
        customer_email: customerEmail,
        customer_first_name: customerFirstName
      }
    });

    return reply.code(201).send({ eventId: event.id });
  });

  app.post('/notifications/test/onesignal-driver-push', async (request, reply) => {
    const parsed = oneSignalDriverPushBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: parsed.error.flatten().fieldErrors
      });
    }

    const { organizationId, driverId, title, message } = parsed.data;
    const timestamp = Date.now();
    const idempotencyKey = `onesignal_driver_push:${organizationId}:${driverId}:${timestamp}`;
    const eventsRepository = new NotificationEventsRepository();
    const deliveriesRepository = new NotificationDeliveriesRepository();
    const resolver = new PushSubscriptionResolverService();
    const oneSignalProvider = new OneSignalProvider();

    const event = await eventsRepository.createEvent({
      organization_id: organizationId,
      event_type: 'driver_job_available',
      source_module: 'push_smoke_test',
      priority: 'critical',
      idempotency_key: idempotencyKey,
      driver_id: driverId,
      payload: {
        title,
        message
      }
    });

    const delivery = await deliveriesRepository.createDelivery({
      organization_id: organizationId,
      event_id: event.id,
      recipient_type: 'driver',
      recipient_selection: 'assigned_driver',
      recipient_id: driverId,
      channel: 'push',
      provider: 'onesignal',
      status: 'queued',
      max_attempts: 3
    });

    try {
      const resolvedIdentity = await resolver.resolveDriverPushIdentity({
        organizationId,
        driverId
      });

      await deliveriesRepository.markDeliverySending(delivery.id);

      const providerResult = await oneSignalProvider.sendPushToExternalUserId({
        externalUserId: resolvedIdentity.externalUserId,
        title,
        message
      });

      await deliveriesRepository.markDeliveryProviderAccepted(delivery.id, providerResult.providerMessageId, {
        provider: 'onesignal',
        resolved_via_fallback: resolvedIdentity.resolvedViaFallback,
        push_subscription_id: resolvedIdentity.subscriptionId,
        response: providerResult.responseMetadata
      });
      await eventsRepository.markEventDelivered(event.id);

      logger.info(
        {
          event_id: event.id,
          delivery_id: delivery.id,
          organization_id: organizationId,
          event_type: event.event_type,
          status: 'delivered'
        },
        'OneSignal driver push smoke test delivered'
      );

      return reply.code(201).send({
        eventId: event.id,
        deliveryId: delivery.id,
        providerMessageId: providerResult.providerMessageId,
        resolvedViaFallback: resolvedIdentity.resolvedViaFallback
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown OneSignal push error';
      const nextRetryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      await deliveriesRepository.markDeliveryFailedRetryable(delivery.id, reason, nextRetryAt);
      await eventsRepository.markEventFailedRetryable(event.id, reason, nextRetryAt);

      logger.warn(
        {
          event_id: event.id,
          delivery_id: delivery.id,
          organization_id: organizationId,
          event_type: event.event_type,
          status: 'failed_retryable'
        },
        'OneSignal driver push smoke test failed'
      );

      return reply.code(502).send({
        error: 'OneSignal smoke push failed',
        eventId: event.id,
        deliveryId: delivery.id
      });
    }
  });

  app.post('/notifications/test/payment-success-customer', async (request, reply) => {
    const parsed = paymentSuccessCustomerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: parsed.error.flatten().fieldErrors
      });
    }

    const { bookingId, bookingReference, customerEmailOverride } = parsed.data;
    const db = getSupabaseAdmin();
    const env = getEnv();
    const DEFAULT_WEBSITE_URL = 'https://vantage-lane.com';
    const supportEmail = 'info@vantage-lane.com';
    const supportPhone = '+44 20 4620 3131';

    let query = db.from('app_notification_payment_success_context').select('*').limit(1);
    if (bookingId) {
      query = query.eq('booking_id', bookingId);
    } else {
      query = query.eq('booking_reference', bookingReference as string);
    }

    const { data: contextData, error: contextError } = await query.maybeSingle();
    if (contextError) {
      return reply.code(500).send({
        error: 'Failed to load payment success context',
        details: contextError.message
      });
    }

    if (!contextData) {
      return reply.code(404).send({
        error: 'Payment success context not found',
        bookingId,
        bookingReference
      });
    }

    const context = contextData as PaymentContextRow;
    const bookingLines = buildBookingLines(context);
    const nowIso = new Date().toISOString();
    const formattedPaymentDate =
      formatDateTime(context.payment_date) ??
      new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: '2-digit' });
    const amountPaid = context.amount_formatted ?? formatAmount(context.amount_pence, context.currency) ?? 'GBP 0.00';
    const customerEmail = customerEmailOverride ?? context.customer_email;
    const receiptUrl =
      asNonEmptyString(context.receipt_url) ??
      env.PUBLIC_WEBSITE_URL ??
      DEFAULT_WEBSITE_URL;

    if (!customerEmail) {
      return reply.code(422).send({
        error: 'Customer email is missing in context and no override provided'
      });
    }

    const eventsRepository = new NotificationEventsRepository();
    const event = await eventsRepository.createEvent({
      organization_id: context.organization_id,
      event_type: 'booking_payment_confirmed',
      source_module: 'payment_smoke_test',
      priority: 'high',
      idempotency_key: `booking_payment_confirmed:${context.organization_id}:${context.booking_id}:${nowIso}`,
      booking_id: context.booking_id,
      customer_id: context.customer_id,
      payload: {
        customer_email: customerEmail,
        customer_first_name: asNonEmptyString(context.customer_first_name) ?? 'there',
        booking_reference: context.booking_reference,
        booking_type: context.booking_type,
        invoice_number: asNonEmptyString(context.invoice_number) ?? 'Pending',
        payment_date: formattedPaymentDate,
        payment_method: normalizePaymentMethod(asNonEmptyString(context.payment_method_raw_or_metadata)),
        amount_paid: amountPaid,
        currency: context.currency ?? 'GBP',
        receipt_url: receiptUrl,
        booking_line_1_label: bookingLines[0]?.label ?? '',
        booking_line_1_value: bookingLines[0]?.value ?? '',
        booking_line_2_label: bookingLines[1]?.label ?? '',
        booking_line_2_value: bookingLines[1]?.value ?? '',
        booking_line_3_label: bookingLines[2]?.label ?? '',
        booking_line_3_value: bookingLines[2]?.value ?? '',
        booking_line_4_label: bookingLines[3]?.label ?? '',
        booking_line_4_value: bookingLines[3]?.value ?? '',
        booking_line_5_label: bookingLines[4]?.label ?? '',
        booking_line_5_value: bookingLines[4]?.value ?? '',
        booking_line_6_label: bookingLines[5]?.label ?? '',
        booking_line_6_value: bookingLines[5]?.value ?? '',
        support_email: supportEmail,
        support_phone: supportPhone,
        context_source: 'app_notification_payment_success_context',
        event_version: 'v1'
      }
    });

    return reply.code(201).send({
      eventId: event.id,
      bookingId: context.booking_id,
      bookingReference: context.booking_reference
    });
  });
}

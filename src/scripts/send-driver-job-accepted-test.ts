/**
 * Trimite driver_job_accepted_v1 cu date reale din DB (același template ca producția).
 * Override doar destinatarul (default test@), ca să vezi exact ce ar primi șoferul.
 *
 * Usage:
 *   npx tsx src/scripts/send-driver-job-accepted-test.ts [toEmail] [bookingReference]
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatUkDateTimeWithLabel } from '../modules/notifications/uk-datetime.js';
import { formatDriverPayoutWholePence } from '../modules/notifications/driver-push.formatter.js';
import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_WHATSAPP
} from '../modules/notifications/notification-shared.js';
import { ResendProvider } from '../modules/providers/resend.provider.js';
import { buildWelcomeBoardPdf } from '../modules/providers/resend/welcome-board.pdf.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: join(ROOT, '.env') });

type BookingRow = {
  booking_id: string;
  organization_id: string;
  reference: string;
  booking_type: string | null;
  passenger_count: number | null;
  bag_count: number | null;
  job_id: string;
  leg_number: number | null;
  leg_kind: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  scheduled_at: string | null;
  driver_id: string | null;
  driver_first_name: string | null;
  driver_email: string | null;
  category_name: string | null;
  model_name: string | null;
  vehicle_category_id: string | null;
  vehicle_model_id: string | null;
  flight_number: string | null;
  driver_payout_pence: number | null;
  payout_currency: string | null;
  hours_requested: number | null;
  days_requested: number | null;
  fleet_total_legs: number | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
};

async function loadBooking(reference: string): Promise<BookingRow> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: booking, error: bookingError } = await db
    .from('bookings')
    .select(
      'id, organization_id, reference, booking_type, passenger_count, bag_count, hours_requested, days_requested, customer_id'
    )
    .eq('reference', reference)
    .is('deleted_at', null)
    .maybeSingle();

  if (bookingError) {
    throw new Error(`bookings lookup failed: ${bookingError.message}`);
  }
  if (!booking) {
    throw new Error(`No booking with reference ${reference}`);
  }

  const { data: leg, error: legError } = await db
    .from('booking_legs')
    .select(
      'id, leg_number, leg_kind, pickup_address, dropoff_address, scheduled_at, assigned_driver_id, vehicle_category_id, vehicle_model_id, flight_number'
    )
    .eq('booking_id', booking.id)
    .is('deleted_at', null)
    .order('leg_number', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (legError) {
    throw new Error(`booking_legs lookup failed: ${legError.message}`);
  }
  if (!leg) {
    throw new Error(`No legs for booking ${reference}`);
  }

  const driverId = typeof leg.assigned_driver_id === 'string' ? leg.assigned_driver_id : null;
  const customerId = typeof booking.customer_id === 'string' ? booking.customer_id : null;
  const [{ data: driver }, { data: category }, { data: model }, { data: ilf }, { data: acceptedEvent }, { data: customer }] =
    await Promise.all([
      driverId
        ? db
            .from('drivers')
            .select('first_name, email')
            .eq('id', driverId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      leg.vehicle_category_id
        ? db
            .from('vehicle_categories')
            .select('name')
            .eq('id', leg.vehicle_category_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      leg.vehicle_model_id
        ? db
            .from('vehicle_models')
            .select('name')
            .eq('id', leg.vehicle_model_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db
        .from('internal_leg_financials')
        .select('driver_payout_pence, currency')
        .eq('booking_leg_id', leg.id)
        .maybeSingle(),
      db
        .from('notification_events')
        .select('payload')
        .eq('organization_id', booking.organization_id)
        .eq('event_type', 'driver_job_accepted')
        .eq('job_id', leg.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      customerId
        ? db
            .from('customers')
            .select('first_name, last_name')
            .eq('id', customerId)
            .maybeSingle()
        : Promise.resolve({ data: null })
    ]);

  const payload = (acceptedEvent?.payload ?? {}) as Record<string, unknown>;
  const payloadTotal =
    typeof payload.driver_total_pence === 'number' ? payload.driver_total_pence : null;
  const payloadBase =
    typeof payload.driver_payout_pence === 'number' ? payload.driver_payout_pence : null;
  const ilfPence =
    typeof ilf?.driver_payout_pence === 'number' ? ilf.driver_payout_pence : null;

  return {
    booking_id: booking.id,
    organization_id: booking.organization_id,
    reference: booking.reference,
    booking_type: booking.booking_type,
    passenger_count: booking.passenger_count,
    bag_count: booking.bag_count,
    job_id: leg.id,
    leg_number: leg.leg_number,
    leg_kind: leg.leg_kind,
    pickup_address: leg.pickup_address,
    dropoff_address: leg.dropoff_address,
    scheduled_at: leg.scheduled_at,
    driver_id: driverId,
    driver_first_name: driver?.first_name ?? null,
    driver_email: driver?.email ?? null,
    category_name: category?.name ?? null,
    model_name: model?.name ?? null,
    vehicle_category_id: leg.vehicle_category_id,
    vehicle_model_id: leg.vehicle_model_id,
    flight_number: typeof leg.flight_number === 'string' ? leg.flight_number : null,
    driver_payout_pence: payloadTotal ?? payloadBase ?? ilfPence,
    payout_currency:
      (typeof payload.payout_currency === 'string' && payload.payout_currency) ||
      (typeof ilf?.currency === 'string' && ilf.currency) ||
      'GBP',
    hours_requested:
      typeof booking.hours_requested === 'number' ? booking.hours_requested : null,
    days_requested: typeof booking.days_requested === 'number' ? booking.days_requested : null,
    fleet_total_legs: null,
    customer_first_name:
      typeof customer?.first_name === 'string' ? customer.first_name : null,
    customer_last_name: typeof customer?.last_name === 'string' ? customer.last_name : null
  };
}

async function main(): Promise<void> {
  const to = process.argv[2]?.trim() || 'test@vantage-lane.com';
  const reference = process.argv[3]?.trim() || 'CB-001030';
  const row = await loadBooking(reference);

  const categoryLabel = row.category_name?.trim() || row.vehicle_category_id || '';
  const modelLabel = row.model_name?.trim() || row.vehicle_model_id || '';
  const vehicleLabel =
    [categoryLabel, modelLabel].filter((part) => part.length > 0).join(' · ') || '—';
  const currency = row.payout_currency || 'GBP';
  const payoutPence = row.driver_payout_pence;
  const driverPayoutDisplay =
    payoutPence != null && payoutPence > 0
      ? formatDriverPayoutWholePence(payoutPence, currency) ?? '—'
      : '—';
  const scheduledAt = formatUkDateTimeWithLabel(row.scheduled_at, { month: 'short' });
  const welcomeBoard = await buildWelcomeBoardPdf({
    customerFirstName: row.customer_first_name,
    customerLastName: row.customer_last_name,
    bookingReference: row.reference
  });

  const resend = new ResendProvider();
  const result = await resend.sendDriverJobAcceptedEmail({
    to,
    driverFirstName: row.driver_first_name?.trim() || 'there',
    bookingReference: row.reference,
    pickupAddress: row.pickup_address ?? '',
    dropoffAddress: row.dropoff_address ?? '',
    scheduledAt,
    passengerCount: row.passenger_count ?? '',
    bagCount: row.bag_count ?? '',
    bookingType: row.booking_type ?? '',
    flightNumber: row.flight_number ?? '',
    vehicleLabel,
    vehicleCategoryId: row.vehicle_category_id ?? '',
    vehicleModelId: row.vehicle_model_id ?? '',
    legKind: row.leg_kind ?? '',
    legNumber: row.leg_number,
    hoursRequested: row.hours_requested,
    daysRequested: row.days_requested,
    fleetTotalLegs: row.fleet_total_legs,
    driverPayoutPence: payoutPence,
    payoutCurrency: currency,
    driverPayoutDisplay,
    supportEmail: DEFAULT_SUPPORT_EMAIL,
    supportPhone: DEFAULT_SUPPORT_PHONE,
    supportWhatsapp: DEFAULT_SUPPORT_WHATSAPP,
    welcomeBoardPdfBase64: Buffer.from(welcomeBoard.bytes).toString('base64'),
    welcomeBoardFilename: welcomeBoard.filename
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'db_backed_template_send',
        to,
        real_driver_email: row.driver_email,
        booking: row.reference,
        job_id: row.job_id,
        vehicle_label: vehicleLabel,
        scheduled_at: scheduledAt,
        payout_display: driverPayoutDisplay,
        flight_number: row.flight_number,
        guest_name: welcomeBoard.guestName,
        welcome_board: welcomeBoard.filename,
        providerMessageId: result.providerMessageId
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

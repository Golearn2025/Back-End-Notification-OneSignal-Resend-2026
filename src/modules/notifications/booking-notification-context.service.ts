import type { SupabaseClient } from '@supabase/supabase-js';

export type BookingNotificationContext = {
  legKind: string | null;
  legNumber: number | null;
  hoursRequested: number | null;
  daysRequested: number | null;
  fleetTotalLegs: number | null;
};

export async function loadBookingNotificationContext(
  db: SupabaseClient,
  input: {
    organizationId: string;
    bookingId: string;
    bookingLegId?: string | null;
    bookingType?: string | null;
  }
): Promise<BookingNotificationContext> {
  const [legKind, legNumber] = await loadLegContext(db, input.organizationId, input.bookingLegId ?? null);
  const [hoursRequested, daysRequested] = await loadBookingDurations(db, input.organizationId, input.bookingId);
  const fleetTotalLegs =
    input.bookingType === 'fleet' ? await countFleetLegs(db, input.organizationId, input.bookingId) : null;

  return {
    legKind,
    legNumber,
    hoursRequested,
    daysRequested,
    fleetTotalLegs
  };
}

async function loadLegContext(
  db: SupabaseClient,
  organizationId: string,
  bookingLegId: string | null
): Promise<[string | null, number | null]> {
  if (!bookingLegId) {
    return [null, null];
  }

  const { data, error } = await db
    .from('booking_legs')
    .select('leg_kind, leg_number')
    .eq('id', bookingLegId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !data) {
    return [null, null];
  }

  const row = data as { leg_kind?: string | null; leg_number?: number | null };
  return [typeof row.leg_kind === 'string' ? row.leg_kind : null, typeof row.leg_number === 'number' ? row.leg_number : null];
}

async function loadBookingDurations(
  db: SupabaseClient,
  organizationId: string,
  bookingId: string
): Promise<[number | null, number | null]> {
  const { data, error } = await db
    .from('bookings')
    .select('hours_requested, days_requested')
    .eq('id', bookingId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error || !data) {
    return [null, null];
  }

  const row = data as { hours_requested?: number | null; days_requested?: number | null };
  return [
    typeof row.hours_requested === 'number' ? row.hours_requested : null,
    typeof row.days_requested === 'number' ? row.days_requested : null
  ];
}

async function countFleetLegs(db: SupabaseClient, organizationId: string, bookingId: string): Promise<number | null> {
  const { count, error } = await db
    .from('booking_legs')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', bookingId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null);

  if (error) {
    return null;
  }

  return typeof count === 'number' ? count : null;
}

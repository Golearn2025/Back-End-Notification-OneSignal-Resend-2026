import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  DEFAULT_SUPPORT_WHATSAPP,
  asNonEmptyString
} from './notification-shared.js';
import type { DriverAssignedCustomerBriefVars } from '../providers/resend/driver-assigned-customer.template.js';

const PHOTO_TYPES = [
  'vehicle_photo_exterior_front',
  'vehicle_photo_exterior_rear',
  'vehicle_photo_interior_front',
  'vehicle_photo_interior_rear'
] as const;

type PhotoType = (typeof PHOTO_TYPES)[number];

const LONDON_TZ = 'Europe/London';

function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.trim().replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  digits = digits.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (digits.startsWith('440') && digits.length >= 12) digits = `44${digits.slice(3)}`;
  if (digits.startsWith('07') && digits.length === 11) return `44${digits.slice(1)}`;
  if (digits.startsWith('7') && digits.length === 10) return `44${digits}`;
  return digits;
}

function formatUkPhoneDisplay(phone: string | null | undefined): string {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return '—';
  if (digits.startsWith('44') && digits.length === 12) {
    return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  return phone?.trim() || '—';
}

function telUrl(phone: string | null | undefined): string {
  const digits = normalizePhoneDigits(phone);
  return digits ? `tel:+${digits}` : '#';
}

function whatsappUrl(phone: string | null | undefined): string {
  const digits = normalizePhoneDigits(phone);
  return digits ? `https://wa.me/${digits}` : '#';
}

function formatInLondon(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: LONDON_TZ, ...options }).format(d);
}

function addMinutesIso(iso: string | null | undefined, minutes: number | null | undefined): string | null {
  if (!iso || minutes == null || !Number.isFinite(minutes)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + minutes * 60_000).toISOString();
}

function placeNameFromAddress(address: string | null | undefined): string {
  const raw = asNonEmptyString(address);
  if (!raw) return '—';
  const first = raw.split(',')[0]?.trim();
  return first || raw;
}

function serviceLabel(bookingType: string | null | undefined): { type: string; description: string } {
  switch ((bookingType ?? '').toLowerCase()) {
    case 'return':
      return { type: 'Return', description: 'Return transfer' };
    case 'hourly':
      return { type: 'Hourly', description: 'Chauffeur by the hour' };
    case 'daily':
      return { type: 'Daily', description: 'Full-day chauffeur' };
    case 'fleet':
      return { type: 'Fleet', description: 'Multi-vehicle booking' };
    case 'oneway':
    default:
      return { type: 'Transfer', description: 'Private chauffeur transfer' };
  }
}

function airlineFromFlight(flight: string | null | undefined): string {
  const f = asNonEmptyString(flight);
  if (!f) return '—';
  const m = f.match(/^([A-Za-z]{2,3})\s*\d/);
  return m?.[1]?.toUpperCase() ?? '—';
}

function distanceDurationLine(miles: number | string | null | undefined, minutes: number | null | undefined): string {
  const parts: string[] = [];
  if (miles != null && String(miles).trim() !== '') {
    const n = typeof miles === 'number' ? miles : Number(miles);
    if (Number.isFinite(n)) parts.push(`${n.toFixed(n >= 10 ? 0 : 1)} mi`);
  }
  if (minutes != null && Number.isFinite(minutes)) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    parts.push(h > 0 ? `${h}h ${m}m` : `${m} min`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

function mapsUrl(
  pickupLat: number | null | undefined,
  pickupLng: number | null | undefined,
  dropoffLat: number | null | undefined,
  dropoffLng: number | null | undefined,
  pickupAddress: string | null | undefined,
  dropoffAddress: string | null | undefined
): string {
  if (
    pickupLat != null &&
    pickupLng != null &&
    dropoffLat != null &&
    dropoffLng != null
  ) {
    return `https://www.google.com/maps/dir/?api=1&origin=${pickupLat},${pickupLng}&destination=${dropoffLat},${dropoffLng}`;
  }
  const origin = asNonEmptyString(pickupAddress);
  const dest = asNonEmptyString(dropoffAddress);
  if (origin && dest) {
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}`;
  }
  return '';
}

export type LoadDriverAssignedBriefInput = {
  organizationId: string;
  bookingId: string;
  bookingLegId: string;
};

/**
 * Loads customer brief fields from existing tables/views only.
 * Vehicle: booking_legs.assigned_vehicle_id, else driver's active vehicle.
 * Photos: vehicle_documents vehicle_photo_* with non-empty file_url.
 */
export async function loadDriverAssignedCustomerBrief(
  db: SupabaseClient,
  input: LoadDriverAssignedBriefInput
): Promise<{ to: string; vars: DriverAssignedCustomerBriefVars } | null> {
  const { data: leg, error: legError } = await db
    .from('booking_legs')
    .select(
      'id, booking_id, organization_id, status, scheduled_at, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, flight_number, distance_miles, duration_min, assigned_driver_id, assigned_vehicle_id'
    )
    .eq('id', input.bookingLegId)
    .eq('organization_id', input.organizationId)
    .is('deleted_at', null)
    .maybeSingle();

  if (legError || !leg) return null;

  const { data: booking, error: bookingError } = await db
    .from('bookings')
    .select('id, reference, booking_type, passenger_count, bag_count, customer_id, organization_id')
    .eq('id', input.bookingId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (bookingError || !booking) return null;

  const customerId = asNonEmptyString((booking as { customer_id?: string | null }).customer_id);
  let customerEmail = '';
  let customerName = 'Guest';
  if (customerId) {
    const { data: customer } = await db
      .from('customers')
      .select('email, first_name, last_name, phone')
      .eq('id', customerId)
      .maybeSingle();
    const c = customer as {
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
    } | null;
    customerEmail = asNonEmptyString(c?.email) ?? '';
    const full = [asNonEmptyString(c?.first_name), asNonEmptyString(c?.last_name)]
      .filter(Boolean)
      .join(' ');
    if (full) customerName = full;
  }

  if (!customerEmail) return null;

  const driverId = asNonEmptyString((leg as { assigned_driver_id?: string | null }).assigned_driver_id);
  if (!driverId) return null;

  const { data: driver } = await db
    .from('drivers')
    .select('id, first_name, last_name, phone, profile_photo_url, profile_photo_status')
    .eq('id', driverId)
    .eq('organization_id', input.organizationId)
    .is('deleted_at', null)
    .maybeSingle();

  const d = driver as {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    profile_photo_url?: string | null;
    profile_photo_status?: string | null;
  } | null;

  const driverName =
    [asNonEmptyString(d?.first_name), asNonEmptyString(d?.last_name)].filter(Boolean).join(' ') ||
    'Your chauffeur';
  const driverPhone = asNonEmptyString(d?.phone);
  // Only show approved profile photos when status is tracked; if status null, allow URL.
  const photoStatus = asNonEmptyString(d?.profile_photo_status);
  const driverPhoto =
    asNonEmptyString(d?.profile_photo_url) &&
    (photoStatus == null || photoStatus === 'approved' || photoStatus === 'pending')
      ? asNonEmptyString(d?.profile_photo_url) ?? ''
      : '';

  let vehicleId = asNonEmptyString((leg as { assigned_vehicle_id?: string | null }).assigned_vehicle_id);
  if (!vehicleId) {
    const { data: vehicles } = await db
      .from('vehicles')
      .select('id, status')
      .eq('driver_id', driverId)
      .eq('organization_id', input.organizationId)
      .is('deleted_at', null)
      .order('status', { ascending: true })
      .limit(10);
    const rows = (vehicles ?? []) as Array<{ id: string; status: string | null }>;
    vehicleId =
      asNonEmptyString(rows.find((v) => v.status === 'active')?.id) ??
      asNonEmptyString(rows[0]?.id) ??
      null;
  }

  let vehicleName = 'Your vehicle';
  let vehicleDescription = '';
  let vehicleRegistration = '—';
  const photos: Partial<Record<PhotoType, string>> = {};

  if (vehicleId) {
    const { data: vehicle } = await db
      .from('vehicles')
      .select('id, year, license_plate, make, model, model_id')
      .eq('id', vehicleId)
      .maybeSingle();
    const v = vehicle as {
      year?: number | null;
      license_plate?: string | null;
      make?: string | null;
      model?: string | null;
      model_id?: string | null;
    } | null;

    vehicleRegistration = asNonEmptyString(v?.license_plate) ?? '—';
    let modelName =
      [asNonEmptyString(v?.make), asNonEmptyString(v?.model)].filter(Boolean).join(' ') || null;
    if (!modelName && v?.model_id) {
      const { data: model } = await db
        .from('vehicle_models')
        .select('name')
        .eq('id', v.model_id)
        .maybeSingle();
      modelName = asNonEmptyString((model as { name?: string | null } | null)?.name);
    }
    vehicleName = modelName ?? 'Your vehicle';
    vehicleDescription = v?.year != null ? String(v.year) : '';

    const { data: docs } = await db
      .from('vehicle_documents')
      .select('document_type, file_url, status')
      .eq('vehicle_id', vehicleId)
      .in('document_type', [...PHOTO_TYPES]);

    for (const row of (docs ?? []) as Array<{
      document_type: string;
      file_url: string | null;
      status: string | null;
    }>) {
      const url = asNonEmptyString(row.file_url);
      if (!url) continue;
      if (PHOTO_TYPES.includes(row.document_type as PhotoType)) {
        photos[row.document_type as PhotoType] = url;
      }
    }
  }

  const scheduledAt = asNonEmptyString((leg as { scheduled_at?: string | null }).scheduled_at);
  const durationMin = (leg as { duration_min?: number | null }).duration_min ?? null;
  const arrivalIso = addMinutesIso(scheduledAt, durationMin);
  const bookingType = asNonEmptyString((booking as { booking_type?: string | null }).booking_type);
  const service = serviceLabel(bookingType);
  const flight = asNonEmptyString((leg as { flight_number?: string | null }).flight_number);
  const pickupAddress = asNonEmptyString((leg as { pickup_address?: string | null }).pickup_address) ?? '';
  const dropoffAddress = asNonEmptyString((leg as { dropoff_address?: string | null }).dropoff_address) ?? '';

  const exteriorFront = photos.vehicle_photo_exterior_front ?? '';
  const photoSlots: Array<{ url: string; label: string }> = [
    { url: photos.vehicle_photo_exterior_front ?? '', label: 'EXTERIOR FRONT' },
    { url: photos.vehicle_photo_exterior_rear ?? '', label: 'EXTERIOR REAR' },
    { url: photos.vehicle_photo_interior_front ?? '', label: 'INTERIOR FRONT' },
    { url: photos.vehicle_photo_interior_rear ?? '', label: 'INTERIOR REAR' }
  ];
  const vars: DriverAssignedCustomerBriefVars = {
    customer_name: customerName,
    date_long: formatInLondon(scheduledAt, { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase(),
    date_short: formatInLondon(scheduledAt, { day: 'numeric', month: 'short' }),
    weekday: formatInLondon(scheduledAt, { weekday: 'long' }),
    pickup_time: formatInLondon(scheduledAt, { hour: '2-digit', minute: '2-digit', hour12: false }),
    pickup_time_note: 'UK time',
    arrival_time: arrivalIso
      ? formatInLondon(arrivalIso, { hour: '2-digit', minute: '2-digit', hour12: false })
      : '—',
    distance_duration: distanceDurationLine(
      (leg as { distance_miles?: number | string | null }).distance_miles,
      durationMin
    ),
    flight_number: flight ?? '—',
    airline: airlineFromFlight(flight),
    passengers: String((booking as { passenger_count?: number | null }).passenger_count ?? '—'),
    luggage: String((booking as { bag_count?: number | null }).bag_count ?? '—'),
    service_type: service.type,
    service_description: service.description,
    pickup_name: placeNameFromAddress(pickupAddress),
    pickup_address: pickupAddress || '—',
    dropoff_name: placeNameFromAddress(dropoffAddress),
    dropoff_address: dropoffAddress || '—',
    maps_url: mapsUrl(
      (leg as { pickup_lat?: number | null }).pickup_lat,
      (leg as { pickup_lng?: number | null }).pickup_lng,
      (leg as { dropoff_lat?: number | null }).dropoff_lat,
      (leg as { dropoff_lng?: number | null }).dropoff_lng,
      pickupAddress,
      dropoffAddress
    ),
    vehicle_name: vehicleName,
    vehicle_description: vehicleDescription,
    vehicle_registration: vehicleRegistration,
    vehicle_hero_url: exteriorFront,
    vehicle_photo_1_url: photoSlots[0]?.url ?? '',
    vehicle_photo_1_label: photoSlots[0]?.label ?? '',
    vehicle_photo_2_url: photoSlots[1]?.url ?? '',
    vehicle_photo_2_label: photoSlots[1]?.label ?? '',
    vehicle_photo_3_url: photoSlots[2]?.url ?? '',
    vehicle_photo_3_label: photoSlots[2]?.label ?? '',
    vehicle_photo_4_url: photoSlots[3]?.url ?? '',
    vehicle_photo_4_label: photoSlots[3]?.label ?? '',
    driver_name: driverName,
    driver_phone: formatUkPhoneDisplay(driverPhone),
    driver_photo_url: driverPhoto,
    driver_call_url: telUrl(driverPhone),
    driver_whatsapp_url: whatsappUrl(driverPhone),
    support_email: DEFAULT_SUPPORT_EMAIL,
    support_email_url: `mailto:${DEFAULT_SUPPORT_EMAIL}`,
    support_phone: DEFAULT_SUPPORT_PHONE,
    support_call_url: telUrl(DEFAULT_SUPPORT_PHONE),
    support_whatsapp: DEFAULT_SUPPORT_WHATSAPP,
    support_whatsapp_url: whatsappUrl(DEFAULT_SUPPORT_WHATSAPP),
    booking_reference: asNonEmptyString((booking as { reference?: string | null }).reference) ?? '',
    customer_email: customerEmail
  };

  return { to: customerEmail, vars };
}

/** Deterministic fixture for local HTML preview (no Resend send). */
export function buildPreviewDriverAssignedCustomerVars(): DriverAssignedCustomerBriefVars {
  /** CB-001030. Hero = exact brief image; grid = 4 small side-by-side. */
  return {
    customer_name: 'Dmitry Merkulov',
    date_long: '14 NOVEMBER 2026',
    date_short: '14 Nov',
    weekday: 'Saturday',
    pickup_time: '15:15',
    pickup_time_note: 'Flight landing time',
    arrival_time: '16:13',
    distance_duration: '27 mi · 58 min',
    flight_number: 'BA571',
    airline: 'British Airways',
    passengers: '2',
    luggage: '2',
    service_type: 'One-way',
    service_description: 'Airport transfer',
    pickup_name: 'Heathrow Airport Terminal 5',
    pickup_address: 'Hounslow TW6 2GA',
    dropoff_name: 'Winnington Road',
    dropoff_address: 'London N2 0TP',
    maps_url:
      'https://www.google.com/maps/dir/?api=1&origin=51.471301,-0.487764&destination=51.582025,-0.170414',
    vehicle_name: 'Mercedes-Benz E-Class',
    vehicle_description: 'Executive · Black · Leather interior',
    vehicle_registration: 'WG75 NNV',
    vehicle_hero_url: '',
    vehicle_photo_1_url: './assets/grid-1.webp',
    vehicle_photo_1_label: 'EXTERIOR FRONT',
    vehicle_photo_2_url: './assets/grid-2.webp',
    vehicle_photo_2_label: 'EXTERIOR REAR',
    vehicle_photo_3_url: './assets/grid-3.webp',
    vehicle_photo_3_label: 'INTERIOR',
    vehicle_photo_4_url: './assets/grid-4.webp',
    vehicle_photo_4_label: 'EXTERIOR SIDE',
    driver_name: 'Adrian Nistor',
    driver_phone: '+44 7387 749123',
    driver_photo_url:
      'https://ruskhucrvjvuuzwlboqn.supabase.co/storage/v1/object/public/driver-profile-photos/fe1c314f-456c-44be-95e7-bd13f0a2fa01/profile.jpeg',
    driver_call_url: 'tel:+447387749123',
    driver_whatsapp_url: 'https://wa.me/447387749123',
    support_email: DEFAULT_SUPPORT_EMAIL,
    support_email_url: `mailto:${DEFAULT_SUPPORT_EMAIL}`,
    support_phone: DEFAULT_SUPPORT_PHONE,
    support_call_url: telUrl(DEFAULT_SUPPORT_PHONE),
    support_whatsapp: DEFAULT_SUPPORT_WHATSAPP,
    support_whatsapp_url: whatsappUrl(DEFAULT_SUPPORT_WHATSAPP),
    booking_reference: 'CB-001030',
    customer_email: 'preview-only@vantage-lane.com'
  };
}

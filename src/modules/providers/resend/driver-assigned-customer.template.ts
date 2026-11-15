import {
  DEFAULT_SUPPORT_EMAIL,
  DRIVER_ASSIGNED_CUSTOMER_TEMPLATE_ALIAS
} from '../../notifications/notification-shared.js';
import type { SendResendTemplateInput } from './send-template.types.js';

/** Dark fallback so Resend never gets empty img src. */
const IMAGE_FALLBACK =
  'https://ruskhucrvjvuuzwlboqn.supabase.co/storage/v1/object/public/email-assets/Vantage_Lane/headers/header-v1-chauffeur-confirmed.webp';

export type DriverAssignedCustomerBriefVars = {
  customer_name: string;
  date_long: string;
  date_short: string;
  weekday: string;
  pickup_time: string;
  pickup_time_note: string;
  arrival_time: string;
  distance_duration: string;
  flight_number: string;
  airline: string;
  passengers: string;
  luggage: string;
  service_type: string;
  service_description: string;
  pickup_name: string;
  pickup_address: string;
  dropoff_name: string;
  dropoff_address: string;
  maps_url: string;
  vehicle_name: string;
  vehicle_description: string;
  vehicle_registration: string;
  vehicle_hero_url: string;
  vehicle_photo_1_url: string;
  vehicle_photo_1_label: string;
  vehicle_photo_2_url: string;
  vehicle_photo_2_label: string;
  vehicle_photo_3_url: string;
  vehicle_photo_3_label: string;
  vehicle_photo_4_url: string;
  vehicle_photo_4_label: string;
  driver_name: string;
  driver_phone: string;
  driver_photo_url: string;
  driver_call_url: string;
  driver_whatsapp_url: string;
  support_email: string;
  support_email_url: string;
  support_phone: string;
  support_call_url: string;
  support_whatsapp: string;
  support_whatsapp_url: string;
  booking_reference: string;
  customer_email: string;
};

export type SendDriverAssignedCustomerEmailInput = {
  to: string;
  subject?: string;
  vars: DriverAssignedCustomerBriefVars;
};

function img(url: string): string {
  const t = url.trim();
  return t.length > 0 ? t : IMAGE_FALLBACK;
}

function text(url: string, fallback = '—'): string {
  const t = url.trim();
  return t.length > 0 ? t : fallback;
}

export function buildDriverAssignedCustomerSubject(vars: DriverAssignedCustomerBriefVars): string {
  const ref = vars.booking_reference?.trim();
  if (ref) return `Your chauffeur is confirmed · ${ref}`;
  return 'Your chauffeur is confirmed · Vantage Lane';
}

/**
 * Maps brief fields → Resend template variables (same pattern as payment / driver_job_accepted).
 */
export function buildDriverAssignedCustomerTemplateSend(
  input: SendDriverAssignedCustomerEmailInput
): SendResendTemplateInput {
  const v = input.vars;
  return {
    to: input.to,
    templateIdOrAlias: DRIVER_ASSIGNED_CUSTOMER_TEMPLATE_ALIAS,
    subject: input.subject ?? buildDriverAssignedCustomerSubject(v),
    replyTo: DEFAULT_SUPPORT_EMAIL,
    tags: [
      { name: 'event_type', value: 'driver_assigned_customer' },
      { name: 'template_alias', value: DRIVER_ASSIGNED_CUSTOMER_TEMPLATE_ALIAS }
    ],
    variables: {
      customer_name: text(v.customer_name, 'Guest'),
      date_long: text(v.date_long),
      date_short: text(v.date_short),
      weekday: text(v.weekday),
      pickup_time: text(v.pickup_time),
      pickup_time_note: text(v.pickup_time_note, 'UK time'),
      arrival_time: text(v.arrival_time),
      distance_duration: text(v.distance_duration),
      flight_number: text(v.flight_number),
      airline: text(v.airline),
      passengers: text(v.passengers),
      luggage: text(v.luggage),
      service_type: text(v.service_type),
      service_description: text(v.service_description),
      pickup_name: text(v.pickup_name),
      pickup_address: text(v.pickup_address),
      dropoff_name: text(v.dropoff_name),
      dropoff_address: text(v.dropoff_address),
      maps_url: text(v.maps_url, 'https://vantage-lane.com'),
      vehicle_name: text(v.vehicle_name, 'Your vehicle'),
      vehicle_description: text(v.vehicle_description, ''),
      vehicle_registration: text(v.vehicle_registration),
      vehicle_hero_url: img(v.vehicle_hero_url),
      vehicle_photo_1_url: img(v.vehicle_photo_1_url),
      vehicle_photo_1_label: text(v.vehicle_photo_1_label, 'EXTERIOR FRONT'),
      vehicle_photo_2_url: img(v.vehicle_photo_2_url),
      vehicle_photo_2_label: text(v.vehicle_photo_2_label, 'EXTERIOR REAR'),
      vehicle_photo_3_url: img(v.vehicle_photo_3_url),
      vehicle_photo_3_label: text(v.vehicle_photo_3_label, 'INTERIOR'),
      vehicle_photo_4_url: img(v.vehicle_photo_4_url),
      vehicle_photo_4_label: text(v.vehicle_photo_4_label, 'EXTERIOR SIDE'),
      driver_name: text(v.driver_name, 'Your chauffeur'),
      driver_phone: text(v.driver_phone),
      driver_photo_url: img(v.driver_photo_url),
      driver_call_url: text(v.driver_call_url, '#'),
      driver_whatsapp_url: text(v.driver_whatsapp_url, '#'),
      support_email: text(v.support_email, DEFAULT_SUPPORT_EMAIL),
      support_email_url: text(v.support_email_url, `mailto:${DEFAULT_SUPPORT_EMAIL}`),
      support_phone: text(v.support_phone),
      support_call_url: text(v.support_call_url, '#'),
      support_whatsapp: text(v.support_whatsapp),
      support_whatsapp_url: text(v.support_whatsapp_url, '#')
    }
  };
}

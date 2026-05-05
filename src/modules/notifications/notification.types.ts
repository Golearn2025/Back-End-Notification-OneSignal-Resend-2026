export type NotificationChannel = 'in_app' | 'push' | 'email';
export type NotificationProvider = 'notifications_table' | 'onesignal' | 'resend' | 'internal';
export type NotificationEventStatus =
  | 'pending'
  | 'ready'
  | 'processing'
  | 'partially_delivered'
  | 'delivered'
  | 'failed_retryable'
  | 'failed_final'
  | 'dead_letter'
  | 'cancelled';
export type NotificationDeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'provider_accepted'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'failed_retryable'
  | 'failed_final'
  | 'suppressed'
  | 'cancelled';

export type NotificationEventType =
  | 'customer_account_created'
  | 'booking_confirmed'
  | 'driver_job_available'
  | 'driver_job_accepted'
  | 'trip_reminder_2h_before_pickup'
  | 'trip_driver_started_pickup'
  | 'trip_driver_arrived'
  | 'trip_passenger_on_board'
  | 'trip_completed'
  | 'booking_cancelled'
  | 'payment_failed'
  | 'booking_payment_confirmed';

export type NotificationEvent = {
  id: string;
  organization_id: string;
  event_type: NotificationEventType | string;
  source_module: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: NotificationEventStatus;
  customer_id: string | null;
  driver_id?: string | null;
  booking_id?: string | null;
  job_id?: string | null;
  occurred_at?: string;
  created_at?: string;
  next_retry_at?: string | null;
  payload: Record<string, unknown>;
};

export type NotificationDelivery = {
  id: string;
  event_id: string;
  organization_id: string;
  recipient_type: 'customer' | 'driver' | 'eligible_driver' | 'admin' | 'operator' | 'jobs_mailbox' | 'system';
  recipient_selection:
    | 'specific_customer'
    | 'assigned_driver'
    | 'eligible_drivers'
    | 'org_admins'
    | 'org_operators'
    | 'fixed_mailbox'
    | 'system_generated';
  recipient_id: string | null;
  recipient_address: string | null;
  channel: NotificationChannel;
  provider: NotificationProvider;
  status: NotificationDeliveryStatus;
};

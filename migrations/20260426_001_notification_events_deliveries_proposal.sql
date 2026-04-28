-- Phase 2 migration proposal (DO NOT APPLY AUTOMATICALLY)
-- Creates:
--   1) public.notification_events
--   2) public.notification_deliveries
--
-- Notes:
-- - This migration is proposal-only and must be reviewed before execution.
-- - Frontend/app clients should NOT access these tables directly.
-- - Future app reads should use dedicated safe views/RPC.

BEGIN;

CREATE TABLE public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  event_type text NOT NULL,
  source_module text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'pending',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  booking_id uuid NULL,
  job_id uuid NULL,
  customer_id uuid NULL,
  driver_id uuid NULL,
  is_urgent boolean NOT NULL DEFAULT false,
  urgent_reason text NULL,
  correlation_id text NULL,
  triggered_by_actor_type text NULL,
  triggered_by_actor_id uuid NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardrail_result jsonb NULL,
  retry_count integer NOT NULL DEFAULT 0,
  max_retry_count integer NOT NULL DEFAULT 3,
  next_retry_at timestamptz NULL,
  processing_started_at timestamptz NULL,
  processed_at timestamptz NULL,
  failed_at timestamptz NULL,
  dead_letter_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_events_event_type_chk CHECK (
    event_type IN (
      'customer_account_created',
      'booking_confirmed',
      'driver_job_available',
      'driver_job_accepted',
      'trip_reminder_2h_before_pickup',
      'trip_driver_started_pickup',
      'trip_driver_arrived',
      'trip_passenger_on_board',
      'trip_completed',
      'booking_cancelled',
      'payment_failed'
    )
  ),
  CONSTRAINT notification_events_priority_chk CHECK (
    priority IN ('critical', 'high', 'normal', 'low')
  ),
  CONSTRAINT notification_events_status_chk CHECK (
    status IN (
      'pending',
      'ready',
      'processing',
      'partially_delivered',
      'delivered',
      'failed_retryable',
      'failed_final',
      'dead_letter',
      'cancelled'
    )
  ),
  CONSTRAINT notification_events_max_retry_count_chk CHECK (max_retry_count >= 1),
  CONSTRAINT notification_events_retry_count_chk CHECK (retry_count >= 0),
  CONSTRAINT notification_events_org_idempotency_uniq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT notification_events_id_org_uniq UNIQUE (id, organization_id)
);

COMMENT ON TABLE public.notification_events IS
  'Source-of-truth notification event ledger. Backend service role only; no direct frontend access.';

CREATE TABLE public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  event_id uuid NOT NULL,
  recipient_type text NOT NULL,
  recipient_selection text NOT NULL,
  recipient_id uuid NULL,
  recipient_address text NULL,
  channel text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt_no integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_retry_at timestamptz NULL,
  sent_at timestamptz NULL,
  delivered_at timestamptz NULL,
  opened_at timestamptz NULL,
  clicked_at timestamptz NULL,
  failed_at timestamptz NULL,
  provider_message_id text NULL,
  provider_error_code text NULL,
  provider_error_message text NULL,
  is_dead_letter boolean NOT NULL DEFAULT false,
  dead_letter_reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_recipient_type_chk CHECK (
    recipient_type IN (
      'customer',
      'driver',
      'eligible_driver',
      'admin',
      'operator',
      'jobs_mailbox',
      'system'
    )
  ),
  CONSTRAINT notification_deliveries_recipient_selection_chk CHECK (
    recipient_selection IN (
      'specific_customer',
      'assigned_driver',
      'eligible_drivers',
      'org_admins',
      'org_operators',
      'fixed_mailbox',
      'system_generated'
    )
  ),
  CONSTRAINT notification_deliveries_channel_chk CHECK (
    channel IN ('in_app', 'push', 'email')
  ),
  CONSTRAINT notification_deliveries_provider_chk CHECK (
    provider IN ('notifications_table', 'onesignal', 'resend', 'internal')
  ),
  CONSTRAINT notification_deliveries_status_chk CHECK (
    status IN (
      'queued',
      'sending',
      'sent',
      'provider_accepted',
      'delivered',
      'opened',
      'clicked',
      'failed_retryable',
      'failed_final',
      'suppressed',
      'cancelled'
    )
  ),
  CONSTRAINT notification_deliveries_max_attempts_chk CHECK (max_attempts >= 1),
  CONSTRAINT notification_deliveries_attempt_no_chk CHECK (attempt_no >= 0),
  CONSTRAINT notification_deliveries_attempt_le_max_chk CHECK (attempt_no <= max_attempts),
  CONSTRAINT notification_deliveries_recipient_presence_chk CHECK (
    recipient_type = 'system'
    OR recipient_id IS NOT NULL
    OR recipient_address IS NOT NULL
  ),
  CONSTRAINT notification_deliveries_email_address_chk CHECK (
    channel <> 'email'
    OR recipient_id IS NOT NULL
    OR recipient_address IS NOT NULL
  ),
  CONSTRAINT notification_deliveries_recipient_selection_compat_chk CHECK (
    (recipient_type <> 'jobs_mailbox' OR recipient_selection = 'fixed_mailbox')
    AND (recipient_type <> 'system' OR recipient_selection = 'system_generated')
    AND (recipient_type <> 'eligible_driver' OR recipient_selection = 'eligible_drivers')
    AND (recipient_type <> 'driver' OR recipient_selection = 'assigned_driver')
    AND (recipient_type <> 'customer' OR recipient_selection = 'specific_customer')
  ),
  CONSTRAINT notification_deliveries_event_org_fk
    FOREIGN KEY (event_id, organization_id)
    REFERENCES public.notification_events(id, organization_id)
    ON DELETE CASCADE
);

-- Keep supporting index for event joins
CREATE INDEX IF NOT EXISTS notification_deliveries_event_id_idx
  ON public.notification_deliveries (event_id);

COMMENT ON TABLE public.notification_deliveries IS
  'Per-recipient per-channel delivery/attempt log. Backend service role only; no direct frontend access.';

-- Uniqueness guard to prevent duplicate logical delivery
-- (event + recipient + channel), resolving recipient by id OR address.
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_event_recipient_channel_uniq_idx
  ON public.notification_deliveries (
    event_id,
    recipient_type,
    COALESCE(recipient_id::text, recipient_address, '__no_recipient__'),
    channel
  );

-- notification_events indexes
CREATE INDEX IF NOT EXISTS notification_events_org_status_next_retry_idx
  ON public.notification_events (organization_id, status, next_retry_at);

CREATE INDEX IF NOT EXISTS notification_events_org_event_type_occurred_at_idx
  ON public.notification_events (organization_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS notification_events_org_booking_id_idx
  ON public.notification_events (organization_id, booking_id);

CREATE INDEX IF NOT EXISTS notification_events_org_job_id_idx
  ON public.notification_events (organization_id, job_id);

CREATE INDEX IF NOT EXISTS notification_events_org_customer_id_idx
  ON public.notification_events (organization_id, customer_id);

CREATE INDEX IF NOT EXISTS notification_events_org_driver_id_idx
  ON public.notification_events (organization_id, driver_id);

CREATE INDEX IF NOT EXISTS notification_events_status_next_retry_pending_ready_failed_idx
  ON public.notification_events (status, next_retry_at)
  WHERE status IN ('pending', 'ready', 'failed_retryable');

CREATE INDEX IF NOT EXISTS notification_events_dead_letter_idx
  ON public.notification_events (organization_id, occurred_at DESC)
  WHERE status = 'dead_letter';

-- notification_deliveries indexes
CREATE INDEX IF NOT EXISTS notification_deliveries_org_status_next_retry_idx
  ON public.notification_deliveries (organization_id, status, next_retry_at);

CREATE INDEX IF NOT EXISTS notification_deliveries_event_channel_status_idx
  ON public.notification_deliveries (event_id, channel, status);

CREATE INDEX IF NOT EXISTS notification_deliveries_org_recipient_type_id_created_idx
  ON public.notification_deliveries (organization_id, recipient_type, recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notification_deliveries_provider_status_created_idx
  ON public.notification_deliveries (provider, status, created_at DESC);

CREATE INDEX IF NOT EXISTS notification_deliveries_dead_letter_idx
  ON public.notification_deliveries (organization_id, created_at DESC)
  WHERE is_dead_letter = true;

CREATE INDEX IF NOT EXISTS notification_deliveries_provider_message_id_idx
  ON public.notification_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- RLS
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

-- Do not expose direct table access to anon/authenticated.
REVOKE ALL ON TABLE public.notification_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.notification_deliveries FROM anon, authenticated;

-- Backend service role full access.
GRANT ALL ON TABLE public.notification_events TO service_role;
GRANT ALL ON TABLE public.notification_deliveries TO service_role;

CREATE POLICY notification_events_service_role_all
  ON public.notification_events
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY notification_deliveries_service_role_all
  ON public.notification_deliveries
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- TODO:
-- If project convention requires an existing updated_at trigger, attach it in a follow-up migration.
-- No new global trigger function is created here by design.

COMMIT;

-- ------------------------------------------------------------------
-- Rollback (manual, review before execution)
-- ------------------------------------------------------------------
-- DROP POLICY IF EXISTS notification_deliveries_service_role_all ON public.notification_deliveries;
-- DROP POLICY IF EXISTS notification_events_service_role_all ON public.notification_events;
--
-- DROP INDEX IF EXISTS public.notification_deliveries_provider_message_id_idx;
-- DROP INDEX IF EXISTS public.notification_deliveries_dead_letter_idx;
-- DROP INDEX IF EXISTS public.notification_deliveries_provider_status_created_idx;
-- DROP INDEX IF EXISTS public.notification_deliveries_org_recipient_type_id_created_idx;
-- DROP INDEX IF EXISTS public.notification_deliveries_event_channel_status_idx;
-- DROP INDEX IF EXISTS public.notification_deliveries_org_status_next_retry_idx;
-- DROP INDEX IF EXISTS public.notification_deliveries_event_id_idx;
-- DROP INDEX IF EXISTS public.notification_deliveries_event_recipient_channel_uniq_idx;
--
-- DROP INDEX IF EXISTS public.notification_events_dead_letter_idx;
-- DROP INDEX IF EXISTS public.notification_events_status_next_retry_pending_ready_failed_idx;
-- DROP INDEX IF EXISTS public.notification_events_org_driver_id_idx;
-- DROP INDEX IF EXISTS public.notification_events_org_customer_id_idx;
-- DROP INDEX IF EXISTS public.notification_events_org_job_id_idx;
-- DROP INDEX IF EXISTS public.notification_events_org_booking_id_idx;
-- DROP INDEX IF EXISTS public.notification_events_org_event_type_occurred_at_idx;
-- DROP INDEX IF EXISTS public.notification_events_org_status_next_retry_idx;
--
-- DROP TABLE IF EXISTS public.notification_deliveries;
-- DROP TABLE IF EXISTS public.notification_events;

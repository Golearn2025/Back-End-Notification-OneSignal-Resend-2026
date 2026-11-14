-- Minimal schema for isolated apply + timed campaign tests (local only).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'test'
);

CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  auth_user_id uuid NOT NULL,
  deleted_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
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
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
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
  failed_at timestamptz NULL,
  provider_message_id text NULL,
  provider_error_message text NULL,
  is_dead_letter boolean NOT NULL DEFAULT false,
  dead_letter_reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_inbox_messages (
  id bigserial PRIMARY KEY,
  auth_user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  inbox_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.enqueue_driver_inbox_message(
  p_auth_user_id uuid,
  p_organization_id uuid,
  p_title text,
  p_body text,
  p_type text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.driver_inbox_messages (auth_user_id, organization_id, title, body, inbox_type)
  VALUES (p_auth_user_id, p_organization_id, p_title, p_body, p_type);
END;
$$;

-- Pre-existing 6-arg function (simulates live DB before 008).
CREATE OR REPLACE FUNCTION public.admin_enqueue_driver_notification(
  p_organization_id uuid,
  p_driver_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id uuid;
  v_auth_user_id uuid;
BEGIN
  SELECT auth_user_id INTO v_auth_user_id
  FROM public.drivers
  WHERE id = p_driver_id AND organization_id = p_organization_id AND deleted_at IS NULL;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'driver not found or missing auth_user_id';
  END IF;

  INSERT INTO public.notification_events (
    organization_id, event_type, source_module, priority, status, idempotency_key,
    driver_id, triggered_by_actor_type, triggered_by_actor_id, payload
  ) VALUES (
    p_organization_id, 'admin_driver_system', 'admin_communications', 'normal', 'pending',
    format('legacy6:%s:%s', p_driver_id, gen_random_uuid()),
    p_driver_id, 'admin_user', p_actor_id,
    jsonb_build_object(
      'push_title', TRIM(p_title),
      'push_body', TRIM(p_body),
      'message', TRIM(p_body),
      'legacy_six_arg', true
    )
  ) RETURNING id INTO v_event_id;

  PERFORM public.enqueue_driver_inbox_message(v_auth_user_id, p_organization_id, TRIM(p_title), TRIM(p_body), p_type);
  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_enqueue_driver_notification(uuid, uuid, text, text, text, uuid) TO PUBLIC;

-- REVIEW ONLY — do not apply automatically to production.
-- Explicit campaign identity for admin driver pushes.
--
-- Problem: admin UI called admin_enqueue_driver_notification once per driver, so a
-- 1_000-driver campaign became 1_000 independent events. The worker could only
-- claim a budget slice → many OneSignal requests. Grouping by title/body alone is
-- unsafe (two intentional sends with the same text must stay distinct).
--
-- This migration:
--   1) Adds optional p_campaign_id to the single-driver enqueue (null = individual).
--   2) Adds admin_enqueue_driver_notification_campaign for full-audience campaigns:
--      one campaign_id, N per-driver events + inbox rows, shared push content.
-- Worker gathers all pending events for a campaign_id before a single OneSignal send.

CREATE OR REPLACE FUNCTION public.admin_enqueue_driver_notification(
  p_organization_id uuid,
  p_driver_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_actor_id uuid DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event_type text;
  v_auth_user_id uuid;
  v_event_id uuid;
  v_section text;
  v_category text;
  v_idempotency_key text;
  v_payload jsonb;
  v_allowed text[] := ARRAY[
    'admin_message',
    'app_update',
    'announcement',
    'account_approved',
    'account_rejected',
    'system',
    'document_approved',
    'document_rejected',
    'document_expired',
    'document_required'
  ];
BEGIN
  IF NOT (p_type = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'invalid inbox type: %', p_type;
  END IF;

  IF NULLIF(TRIM(p_title), '') IS NULL OR NULLIF(TRIM(p_body), '') IS NULL THEN
    RAISE EXCEPTION 'title and body are required';
  END IF;

  IF p_type IN (
    'document_approved',
    'document_rejected',
    'document_expired',
    'document_required'
  ) THEN
    v_section := 'documents';
    v_category := 'documents';
    v_event_type := 'admin_driver_documents';
  ELSE
    v_section := 'updates';
    v_category := 'system';
    v_event_type := 'admin_driver_system';
  END IF;

  SELECT d.auth_user_id
  INTO v_auth_user_id
  FROM public.drivers d
  WHERE d.id = p_driver_id
    AND d.organization_id = p_organization_id
    AND d.deleted_at IS NULL;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'driver not found or missing auth_user_id';
  END IF;

  v_idempotency_key := format(
    'admin_inbox_%s:%s:%s:%s',
    p_type,
    p_organization_id,
    p_driver_id,
    gen_random_uuid()::text
  );

  v_payload := jsonb_build_object(
    'event_type', v_event_type,
    'category', v_category,
    'section', v_section,
    'inbox_type', p_type,
    'push_title', TRIM(p_title),
    'push_body', TRIM(p_body),
    'message', TRIM(p_body),
    'channels', jsonb_build_array('push', 'inbox')
  );

  IF p_campaign_id IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object(
      'campaign_id', p_campaign_id,
      'campaign_scope', 'bulk'
    );
  ELSE
    v_payload := v_payload || jsonb_build_object('campaign_scope', 'individual');
  END IF;

  INSERT INTO public.notification_events (
    organization_id,
    event_type,
    source_module,
    priority,
    status,
    idempotency_key,
    driver_id,
    triggered_by_actor_type,
    triggered_by_actor_id,
    payload
  )
  VALUES (
    p_organization_id,
    v_event_type,
    'admin_communications',
    'normal',
    'pending',
    v_idempotency_key,
    p_driver_id,
    'admin_user',
    p_actor_id,
    v_payload
  )
  RETURNING id INTO v_event_id;

  -- Per-driver inbox/history preserved (campaign or individual).
  PERFORM public.enqueue_driver_inbox_message(
    v_auth_user_id,
    p_organization_id,
    TRIM(p_title),
    TRIM(p_body),
    p_type
  );

  RETURN v_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_enqueue_driver_notification_campaign(
  p_organization_id uuid,
  p_driver_ids uuid[],
  p_type text,
  p_title text,
  p_body text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id uuid := gen_random_uuid();
  v_driver_id uuid;
  v_count integer := 0;
BEGIN
  IF p_driver_ids IS NULL OR array_length(p_driver_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_driver_ids must be a non-empty array';
  END IF;

  FOREACH v_driver_id IN ARRAY p_driver_ids
  LOOP
    PERFORM public.admin_enqueue_driver_notification(
      p_organization_id,
      v_driver_id,
      p_type,
      p_title,
      p_body,
      p_actor_id,
      v_campaign_id
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'no drivers enqueued';
  END IF;

  RETURN v_campaign_id;
END;
$function$;

COMMENT ON FUNCTION public.admin_enqueue_driver_notification(uuid, uuid, text, text, text, uuid, uuid) IS
  'Enqueue one admin driver notification (inbox + push event). Optional p_campaign_id links bulk campaign members; null = individual.';

COMMENT ON FUNCTION public.admin_enqueue_driver_notification_campaign(uuid, uuid[], text, text, text, uuid) IS
  'Enqueue a full-audience admin campaign: one new campaign_id, N per-driver events/inbox rows, shared push content.';

REVOKE ALL ON FUNCTION public.admin_enqueue_driver_notification(uuid, uuid, text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_enqueue_driver_notification_campaign(uuid, uuid[], text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_driver_notification(uuid, uuid, text, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_driver_notification_campaign(uuid, uuid[], text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_driver_notification(uuid, uuid, text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_driver_notification_campaign(uuid, uuid[], text, text, text, uuid) TO authenticated;

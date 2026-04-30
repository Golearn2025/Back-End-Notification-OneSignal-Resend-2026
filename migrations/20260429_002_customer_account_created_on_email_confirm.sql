-- Enqueue customer_account_created notification event when auth email is confirmed.
-- This covers the transition auth.users.email_confirmed_at: NULL -> NOT NULL.

CREATE OR REPLACE FUNCTION public.enqueue_customer_account_created_on_email_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_customer_id uuid;
  v_organization_id uuid;
  v_customer_email text;
  v_customer_first_name text;
  v_first_name_from_auth text;
  v_idempotency_key text;
BEGIN
  -- Fire only on first transition NULL -> NOT NULL.
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id, c.organization_id, c.email, c.first_name
    INTO v_customer_id, v_organization_id, v_customer_email, v_customer_first_name
  FROM public.customers c
  WHERE c.auth_user_id = NEW.id
    AND c.deleted_at IS NULL
  ORDER BY c.created_at ASC
  LIMIT 1;

  -- If no customer row exists yet, do not fail auth flow.
  IF v_customer_id IS NULL OR v_organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Prefer real first name from profile metadata; avoid generic "Guest".
  v_first_name_from_auth := NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), '');
  IF v_customer_first_name IS NULL
     OR NULLIF(TRIM(v_customer_first_name), '') IS NULL
     OR LOWER(TRIM(v_customer_first_name)) = 'guest' THEN
    v_customer_first_name := v_first_name_from_auth;
  END IF;

  v_idempotency_key := format(
    'customer_account_created:email_confirmed:%s:%s',
    v_organization_id,
    NEW.id
  );

  INSERT INTO public.notification_events (
    organization_id,
    event_type,
    source_module,
    priority,
    status,
    idempotency_key,
    customer_id,
    payload
  )
  VALUES (
    v_organization_id,
    'customer_account_created',
    'auth_email_confirmation',
    'normal',
    'pending',
    v_idempotency_key,
    v_customer_id,
    jsonb_build_object(
      'customer_email', COALESCE(v_customer_email, NEW.email),
      'customer_first_name', COALESCE(v_customer_first_name, 'there')
    )
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed_enqueue_customer_account_created ON auth.users;

CREATE TRIGGER on_auth_user_email_confirmed_enqueue_customer_account_created
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_customer_account_created_on_email_confirm();


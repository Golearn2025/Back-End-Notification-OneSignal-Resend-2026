-- Enqueue driver_job_accepted when a booking leg is ASSIGNED with a driver (email + push handled by backend-notifications).

CREATE OR REPLACE FUNCTION public.enqueue_driver_job_accepted_on_assigned_leg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency_key text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'ASSIGNED'::leg_status OR NEW.assigned_driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_idempotency_key := format(
    'driver_job_accepted:%s:%s:assigned',
    NEW.organization_id,
    NEW.id
  );

  INSERT INTO public.notification_events (
    organization_id,
    event_type,
    source_module,
    priority,
    status,
    idempotency_key,
    booking_id,
    job_id,
    driver_id,
    payload
  )
  VALUES (
    NEW.organization_id,
    'driver_job_accepted',
    'booking_leg_assigned',
    'normal',
    'pending',
    v_idempotency_key,
    NEW.booking_id,
    NEW.id,
    NEW.assigned_driver_id,
    jsonb_build_object(
      'job_id', NEW.id,
      'booking_id', NEW.booking_id
    )
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_booking_leg_assigned_enqueue_driver_job_accepted ON public.booking_legs;

CREATE TRIGGER on_booking_leg_assigned_enqueue_driver_job_accepted
AFTER INSERT OR UPDATE OF status, assigned_driver_id, deleted_at ON public.booking_legs
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_driver_job_accepted_on_assigned_leg();

-- Enqueue driver_job_available event when a booking leg becomes pending and unassigned.

CREATE OR REPLACE FUNCTION public.enqueue_driver_job_available_on_pending_leg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_reference text;
  v_booking_type text;
  v_currency text;
  v_idempotency_key text;
BEGIN
  -- Run only when leg is pending and not assigned.
  IF NEW.status <> 'PENDING' OR NEW.assigned_driver_id IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- On update, avoid duplicate enqueue unless status/assignment transitioned.
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.status::text, '') = 'PENDING'
       AND OLD.assigned_driver_id IS NULL
       AND OLD.deleted_at IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT b.reference, b.booking_type::text, b.currency
    INTO v_booking_reference, v_booking_type, v_currency
  FROM public.bookings b
  WHERE b.id = NEW.booking_id
  LIMIT 1;

  v_idempotency_key := format(
    'driver_job_available:%s:%s:pending',
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
    payload
  )
  VALUES (
    NEW.organization_id,
    'driver_job_available',
    'dispatch_pending_leg',
    'high',
    'pending',
    v_idempotency_key,
    NEW.booking_id,
    NEW.id,
    jsonb_build_object(
      'booking_reference', v_booking_reference,
      'booking_type', v_booking_type,
      'currency', v_currency,
      'job_id', NEW.id,
      'booking_id', NEW.booking_id,
      'pickup_address', NEW.pickup_address,
      'dropoff_address', NEW.dropoff_address,
      'scheduled_at', NEW.scheduled_at,
      'vehicle_category_id', NEW.vehicle_category_id,
      'vehicle_model_id', NEW.vehicle_model_id
    )
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_booking_leg_pending_enqueue_driver_job_available ON public.booking_legs;

CREATE TRIGGER on_booking_leg_pending_enqueue_driver_job_available
AFTER INSERT OR UPDATE OF status, assigned_driver_id, deleted_at ON public.booking_legs
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_driver_job_available_on_pending_leg();


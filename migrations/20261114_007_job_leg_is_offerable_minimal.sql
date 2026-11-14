-- REVIEW ONLY — do not apply automatically to production.
-- Minimal offerability helper for notifications worker (no Stage1 package).
-- Aligns with enqueue rule in 20260429_003: PENDING + no assigned driver + not deleted.
--
-- Deploy prerequisite: apply this (or equivalent) BEFORE enabling offerability gate in worker.
-- If function is missing, worker fail-closes (dead_letter) and does NOT send.

CREATE OR REPLACE FUNCTION public.job_leg_is_offerable(p_booking_leg_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_assigned uuid;
  v_deleted_at timestamptz;
BEGIN
  IF p_booking_leg_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    bl.status::text,
    bl.assigned_driver_id,
    bl.deleted_at
  INTO
    v_status,
    v_assigned,
    v_deleted_at
  FROM public.booking_legs bl
  WHERE bl.id = p_booking_leg_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Only unpaid/open dispatch pool legs are offerable for driver_job_available.
  IF v_status IS DISTINCT FROM 'PENDING' THEN
    RETURN false;
  END IF;

  IF v_assigned IS NOT NULL THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.job_leg_is_offerable(uuid) IS
  'Minimal offerability check for notification sends: PENDING, unassigned, not deleted.';

REVOKE ALL ON FUNCTION public.job_leg_is_offerable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.job_leg_is_offerable(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.job_leg_is_offerable(uuid) TO postgres;

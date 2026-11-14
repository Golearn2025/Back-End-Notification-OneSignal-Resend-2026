-- Isolated Postgres smoke test for job_leg_is_offerable (local only).
-- Run: psql -d postgres -v ON_ERROR_STOP=1 -f migrations/20261114_007_job_leg_is_offerable_isolated_test.sql
-- Creates temp schema objects, asserts results, rolls back.

BEGIN;

CREATE SCHEMA IF NOT EXISTS notif_offer_test;
SET LOCAL search_path = notif_offer_test, public;

DO $$ BEGIN
  CREATE TYPE notif_offer_test.leg_status AS ENUM (
    'PENDING', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'STARTED',
    'COMPLETED', 'CANCELLED', 'ONBOARD', 'IN_PROGRESS'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notif_offer_test.booking_legs (
  id uuid PRIMARY KEY,
  status notif_offer_test.leg_status NOT NULL,
  assigned_driver_id uuid NULL,
  deleted_at timestamptz NULL
);

-- Shadow public.booking_legs for the function body by creating public synonym via search_path:
-- We recreate the function against notif_offer_test.booking_legs by temporarily mapping.
CREATE OR REPLACE FUNCTION notif_offer_test.job_leg_is_offerable(p_booking_leg_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_status text;
  v_assigned uuid;
  v_deleted_at timestamptz;
BEGIN
  IF p_booking_leg_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT bl.status::text, bl.assigned_driver_id, bl.deleted_at
  INTO v_status, v_assigned, v_deleted_at
  FROM notif_offer_test.booking_legs bl
  WHERE bl.id = p_booking_leg_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;
  IF v_status IS DISTINCT FROM 'PENDING' THEN
    RETURN false;
  END IF;
  IF v_assigned IS NOT NULL THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

TRUNCATE notif_offer_test.booking_legs;

INSERT INTO notif_offer_test.booking_legs (id, status, assigned_driver_id, deleted_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'PENDING', NULL, NULL),
  ('22222222-2222-2222-2222-222222222222', 'ASSIGNED', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL),
  ('33333333-3333-3333-3333-333333333333', 'PENDING', NULL, now()),
  ('44444444-4444-4444-4444-444444444444', 'CANCELLED', NULL, NULL);

DO $$
BEGIN
  IF notif_offer_test.job_leg_is_offerable('11111111-1111-1111-1111-111111111111') IS NOT TRUE THEN
    RAISE EXCEPTION 'expected PENDING unassigned to be offerable';
  END IF;
  IF notif_offer_test.job_leg_is_offerable('22222222-2222-2222-2222-222222222222') IS NOT FALSE THEN
    RAISE EXCEPTION 'expected ASSIGNED to be non-offerable';
  END IF;
  IF notif_offer_test.job_leg_is_offerable('33333333-3333-3333-3333-333333333333') IS NOT FALSE THEN
    RAISE EXCEPTION 'expected deleted leg to be non-offerable';
  END IF;
  IF notif_offer_test.job_leg_is_offerable('44444444-4444-4444-4444-444444444444') IS NOT FALSE THEN
    RAISE EXCEPTION 'expected CANCELLED to be non-offerable';
  END IF;
  IF notif_offer_test.job_leg_is_offerable('99999999-9999-9999-9999-999999999999') IS NOT FALSE THEN
    RAISE EXCEPTION 'expected missing leg to be non-offerable';
  END IF;
  RAISE NOTICE 'job_leg_is_offerable isolated tests PASSED';
END $$;

ROLLBACK;

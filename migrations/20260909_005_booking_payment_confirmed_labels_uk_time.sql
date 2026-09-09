-- Clarify booking confirmation emails by separating booked-at vs pickup time
-- and explicitly marking both timestamps as UK time.

CREATE OR REPLACE FUNCTION public.enqueue_booking_payment_confirmed_on_payment_succeeded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ctx record;
  v_payment_date_text text;
  v_amount_paid text;
  v_receipt_url text;
  v_payment_method text;
  v_booking_type_label text;
  v_when_label text;
  v_pickup text;
  v_dropoff text;
  v_vehicle_class text;
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status::text, '') = 'succeeded' THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_ctx
  FROM public.app_notification_payment_success_context c
  WHERE c.payment_id = NEW.id
  LIMIT 1;

  IF v_ctx IS NULL THEN
    RETURN NEW;
  END IF;

  v_payment_date_text := COALESCE(
    to_char(COALESCE(v_ctx.payment_date, now()) AT TIME ZONE 'Europe/London', 'DD Month YYYY, HH24:MI') || ' UK time',
    'Pending'
  );
  v_amount_paid := COALESCE(to_char(COALESCE(v_ctx.amount_pence, 0)::numeric / 100.0, 'FM999999990.00'), '0.00');
  v_receipt_url := COALESCE(v_ctx.receipt_url, 'https://vantage-lane.com');
  v_payment_method := COALESCE(NULLIF(v_ctx.payment_method_raw_or_metadata, ''), 'Payment confirmed');
  v_booking_type_label := CASE
    WHEN v_ctx.booking_type = 'oneway' THEN 'One Way'
    ELSE initcap(COALESCE(v_ctx.booking_type, 'Booking'))
  END;
  v_when_label := COALESCE(
    to_char(v_ctx.first_scheduled_at AT TIME ZONE 'Europe/London', 'DD Month YYYY, HH24:MI') || ' UK time',
    'Pending confirmation'
  );
  v_pickup := COALESCE((v_ctx.legs_json->0->>'pickup_address'), 'Unknown pickup');
  v_dropoff := COALESCE((v_ctx.legs_json->0->>'dropoff_address'), 'Unknown dropoff');
  v_vehicle_class := COALESCE(v_ctx.vehicle_model_id, v_ctx.vehicle_category_id, 'To be assigned');

  INSERT INTO public.notification_events (
    organization_id,
    event_type,
    source_module,
    priority,
    status,
    idempotency_key,
    booking_id,
    customer_id,
    payload
  )
  VALUES (
    v_ctx.organization_id,
    'booking_payment_confirmed',
    'payment_succeeded',
    'high',
    'pending',
    format('booking_payment_confirmed:payment_succeeded:%s:%s', v_ctx.organization_id, v_ctx.payment_id),
    v_ctx.booking_id,
    v_ctx.customer_id,
    jsonb_build_object(
      'customer_email', v_ctx.customer_email,
      'customer_first_name', COALESCE(v_ctx.customer_first_name, 'there'),
      'booking_reference', v_ctx.booking_reference,
      'booking_type', v_ctx.booking_type,
      'invoice_number', COALESCE(v_ctx.invoice_number, 'Pending'),
      'payment_date', v_payment_date_text,
      'payment_method', v_payment_method,
      'amount_paid', v_amount_paid,
      'currency', COALESCE(v_ctx.currency, 'GBP'),
      'receipt_url', v_receipt_url,
      'pickup_location', v_pickup,
      'dropoff_location', v_dropoff,
      'pickup_time', v_when_label,
      'vehicle_class', v_vehicle_class,
      'admin_booking_url', v_receipt_url,
      'booking_line_1_label', 'Booking Type',
      'booking_line_1_value', v_booking_type_label,
      'booking_line_2_label', 'Reference',
      'booking_line_2_value', COALESCE(v_ctx.booking_reference, '-'),
      'booking_line_3_label', 'Pickup time',
      'booking_line_3_value', v_when_label,
      'booking_line_4_label', 'Route',
      'booking_line_4_value', v_pickup || ' -> ' || v_dropoff,
      'booking_line_5_label', 'Vehicle',
      'booking_line_5_value', v_vehicle_class,
      'booking_line_6_label', 'Passengers/Luggage',
      'booking_line_6_value', COALESCE(v_ctx.passenger_count, 0)::text || ' / ' || COALESCE(v_ctx.bag_count, 0)::text,
      'support_email', 'info@vantage-lane.com',
      'support_phone', '+44 20 4620 3131',
      'context_source', 'app_notification_payment_success_context',
      'event_version', 'v1'
    )
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

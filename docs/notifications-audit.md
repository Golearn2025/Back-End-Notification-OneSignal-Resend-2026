# Notifications Coverage Audit

This document tracks payload contracts, DB validation points, and production readiness for:

- `booking_payment_confirmed`
- `driver_job_available`
- `driver_job_accepted`

## 1) Payload Contract by Flow

### `booking_payment_confirmed` (customer + jobs mailbox email)

Required payload keys:

- `customer_email`
- `customer_first_name`
- `invoice_number`
- `payment_date`
- `payment_method`
- `amount_paid`
- `currency`
- `receipt_url`
- `booking_line_1_label` ... `booking_line_6_value`

Delivery channels:

- `email` to customer via `payment_success_customer_v1`
- `email` to jobs mailbox via `jobs_mailbox_booking_confirmed_v1`

### `driver_job_available` (push)

Required payload keys:

- `booking_reference`
- `booking_type`
- `job_id`
- `booking_id`
- `pickup_address`
- `dropoff_address` (optional for some booking types)
- `scheduled_at`
- `vehicle_category_id`
- `vehicle_model_id`

Derived context (enriched in handler):

- `leg_kind`, `leg_number`
- `hours_requested`, `days_requested`
- `fleet_total_legs`

Delivery channels:

- `push` via OneSignal

### `driver_job_accepted` (email + push)

View source:

- `driver_jobs_accepted_v1` + booking enrichment queries

Core fields:

- `job_id`, `booking_id`, `booking_reference`
- `booking_type`, `leg_kind`, `leg_number`
- `pickup_address`, `dropoff_address`, `scheduled_at`
- `vehicle_category_id`, `vehicle_model_id`
- `passenger_count`, `bag_count`
- `driver_payout_pence`, `payout_currency`
- `driver_email`, `driver_id`

Derived context:

- `hours_requested`, `days_requested`
- `fleet_total_legs`

Delivery channels:

- `email` via `driver_job_accepted_v1`
- `push` via OneSignal

## 2) Booking Type Coverage

| Booking type | Payment customer email | Jobs mailbox email | Driver available push | Driver accepted push | Driver accepted email |
| --- | --- | --- | --- | --- | --- |
| `oneway` | PASS | PASS | PASS | PASS | PASS |
| `return` | PASS | PASS | PASS | PASS (leg-aware) | PASS (leg vars available) |
| `hourly` | PASS | PASS | PASS (duration-aware) | PASS (duration-aware) | PASS (duration vars available) |
| `daily` | PASS | PASS | PASS (duration-aware) | PASS (duration-aware) | PASS (duration vars available) |
| `fleet` | PASS | PASS | PASS (anti-spam guard for leg > 1) | PASS (fleet summary aware) | PASS (fleet vars available) |

## 3) Fleet Anti-Spam Rule

Implemented guard in `driver_job_available`:

- For `booking_type = fleet`, send push only for `leg_number = 1`.
- For `leg_number > 1`, mark event delivered without sending push.

This avoids burst notifications (e.g. 20 legs => 20 pushes).

## 4) DB Validation Queries (pre-merge checklist)

```sql
-- latest events per flow
select event_type, status, count(*)
from public.notification_events
where event_type in ('booking_payment_confirmed','driver_job_available','driver_job_accepted')
group by event_type, status
order by event_type, status;
```

```sql
-- deliveries by channel/provider
select n.event_type, d.channel, d.provider, d.status, count(*) as total
from public.notification_deliveries d
join public.notification_events n on n.id = d.event_id
where n.event_type in ('booking_payment_confirmed','driver_job_available','driver_job_accepted')
group by n.event_type, d.channel, d.provider, d.status
order by n.event_type, d.channel, d.status;
```

```sql
-- driver accepted view sanity
select booking_type, count(*) as rows
from public.driver_jobs_accepted_v1
group by booking_type
order by booking_type;
```


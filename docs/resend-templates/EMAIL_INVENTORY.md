# Inventar emailuri Resend — Vantage Lane

Scop: când terminăm fiecare template, îl marcăm aici. La final ștergem / deprecăm ce nu mai e folosit.

**Contact SSOT (client):**
- Email: `contact@vantage-lane.com`
- WhatsApp: `+44 7376 188443` (`wa.me/447376188443`)
- Office / landline: `+44 20 4534 7305`
- Times: `Europe/London` (+ label UK time)

---

## Client (customer)

| # | Alias Resend | Nume afișat | Când se trimite | Status | Note |
|---|--------------|-------------|-----------------|--------|------|
| C1 | `payment_success_customer_v1` | Payment successful | Plată booking reușită | **DONE v2** | Pickup/dropoff/flight/category/vehicle; butoane Email/WA/Call |
| C2 | `customer_account_created_v1` | Welcome | Confirmare email / cont creat | **DONE v2** | CTA Book a journey; butoane Email/WA/Call |
| C3 | *(nou)* `customer_driver_assigned_v1` | Driver assigned | După accept șofer | **TODO** | Nu există pe Resend; design vechi în Driver app |
| C4 | *(opțional)* trip started / arriving / completed / cancelled | — | Lifecycle trip | **NU pe Resend** | Doar HTML în `Vantage-Lane-App-Driver/.../email-templates/` — de decis ce păstrăm |

---

## Intern / mailbox

| # | Alias Resend | Nume | Status | Note |
|---|--------------|------|--------|------|
| I1 | `jobs_mailbox_booking_confirmed_v1` | New booking → newjobs@ | Live (vechi) | Vehicle încă ID; admin URL greșit (receipt) — de aliniat |
| I2 | *(design)* internal new booking / urgent | — | Nu pe Resend | HTML Driver templates 14–15 |

---

## Șofer (driver)

| # | Alias Resend | Nume | Status | Note |
|---|--------------|------|--------|------|
| D1 | `driver_job_accepted_v1` | Job accepted | **DONE v2** | Header; Flight + meet&greet duty; PDF welcome board (blank template + name 2 lines); push OneSignal |
| D2 | `driver_document_expiring_v1` | Document expiring 30/15/1 | Live (schelet) | De modernizat + CTA Documents |
| D3 | *(nou)* `driver_job_reminder_v1` | Job reminder 3h | **TODO** | Email backup dacă push off; doar 3h nu 1h |

---

## De curățat ulterior (când închidem lista DONE)

1. HTML-uri din `Vantage-Lane-App-Driver/supabase/functions/email-templates/` care **nu** au alias Resend + handler → arhiva sau delete după confirmare.
2. `info@vantage-lane.com` hardcodat în replyTo vechi → înlocuit cu `contact@` pe client.
3. Template-uri Resend dashboard fără alias în tabelul de mai sus → deprecate / delete.
4. Variabile legacy `booking_line_*` pe payment — încă populate în SQL pentru mailbox; pe HTML client **nu** se mai folosesc.

---

## Istoric terminări

| Data | Alias | Ce s-a făcut |
|------|-------|--------------|
| 2026-11-14 | `payment_success_customer_v1` | v2 modern + contact butoane; test `test@` |
| 2026-11-14 | `customer_account_created_v1` | v2 modern + contact butoane; test `test@` |
| 2026-11-14 | `driver_job_accepted_v1` | v2 header job-confirmed-driver + vehicle_label + footer contact |
| 2026-11-14 | `driver_job_accepted_v1` | Flight rows HTML; meet&greet duty; welcome-board PDF attach (blank template) |

---

## Următorul pe listă (client)

**C3 — Driver assigned** (email nou după accept șofer).

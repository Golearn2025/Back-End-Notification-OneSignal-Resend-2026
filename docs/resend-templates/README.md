# Template-uri Resend (Vantage Lane)

Backend-ul trimite emailuri prin API-ul Resend cu **`template.id`** = aliasul template-ului și **`template.variables`** = chei **snake_case** (exact ca în cod). În editorul Resend, variabilele se inserează cu **`{{{nume_cheie}}}`** (triplu acoladă), conform [documentației Resend](https://resend.com/docs/dashboard/templates/template-variables).

## Cum lucrați „frumos și rapid” fără scripturi (header-uri WebP)

În multe echipe (inclusiv ce descrii cu `header-v1-*.webp` și variante „actions”) fluxul **nu** e din repo, ci:

1. **Design** (ex. Figma) → export **banner/header** WebP + eventual slice pentru butoane („actions”).
2. **Hosting** — imaginile stau pe **CDN / site public** (URL fix, ex. `https://…/header-v1-payment-success.webp`), nu neapărat în Git.
3. **Resend** — în **Templates** construiești vizual (sau HTML) în dashboard: `<img src="…">` cu URL-ul static, apoi adaugi **`{{{variabile}}}`** doar pentru texte dinamice (nume, sumă, link magic etc.).
4. **Publish** din Resend; backend-ul vostru trimite doar **alias + variabile** — la fel ca înainte.

**Cine făcea HTML-ul:** de obicei **designerul** (layout + export) + **cineva cu acces Resend** (lipire în template + variabile). Fără script e perfect valid dacă așa mergeți rapid.

**Legătură cu asset-urile tale** (pentru serviciul `backend-notifications`):

| Asset (exemplu) | Template / flux tipic în acest serviciu |
|-------------------|-------------------------------------------|
| `header-v1-welcome-account-correct.webp` | `customer_account_created_v1` |
| `header-v1-payment-success.webp` | `payment_success_customer_v1` |
| `header-v1-jobs-mailbox.webp` | `jobs_mailbox_booking_confirmed_v1` |
| `header-v1-driver-job-accepted.webp` | `driver_job_accepted_v1` |
| `header-v1-magic-link`, `reset-password`, `confirm-signup`, `reauthentication`, `invite-user`, `confirm-email-change` | de obicei **Supabase Auth / alt produs**, nu neapărat acest worker de notificări — tot pe același principiu: URL imagine + variabile în Resend. |

HTML-urile din acest folder sunt **schelete** text-only; poți înlocui în Resend (sau în fișiere + `npm run publish-resend-templates`) cu același header WebP ca în workflow-ul vostru vechi.

---

## Opțional: publicare din repo

Dacă vreți totuși să împingă HTML din Git către API:
`npm run publish-resend-templates` (necesită `RESEND_TEMPLATE_AUDIT_API_KEY` sau `RESEND_API_KEY` cu drepturi Templates). Dacă preferați **doar dashboard**, ignorați scriptul.

## Aliasuri obligatorii (trebuie să coincidă cu codul)

| Alias în Resend | Folosit pentru |
|-----------------|----------------|
| `customer_account_created_v1` | Cont client creat |
| `payment_success_customer_v1` | Plată booking confirmată (client) |
| `jobs_mailbox_booking_confirmed_v1` | Notificare către mailbox joburi |
| `driver_job_accepted_v1` | Șofer: job acceptat |

Subiectul și `reply_to` pot fi suprascrise de la API (așa face deja `ResendProvider`).

### Variabile noi recomandate pentru `driver_job_accepted_v1`

Pentru acoperire completă pe `return` / `hourly` / `daily` / `fleet`, template-ul poate folosi și:

- `{{{leg_kind}}}`
- `{{{leg_number}}}`
- `{{{hours_requested}}}`
- `{{{days_requested}}}`
- `{{{fleet_total_legs}}}`

## Pași în dashboard Resend

1. **Templates** → **Create template**.
2. Nume afișat: la alegere; setează **published alias** exact ca în tabel (ex. `customer_account_created_v1`).
3. Copiază HTML din fișierul `.html` cu același nume din acest folder în editor.
4. Pentru fiecare `{{{cheie}}}` din HTML, definește variabila în Resend (aceeași cheie, tip string, fallback opțional).
5. **Publish** template-ul înainte de trimiteri din producție.

## Variabile rezervate Resend

Nu folosi cheile rezervate: `FIRST_NAME`, `LAST_NAME`, `EMAIL`, `UNSUBSCRIBE_URL`, `contact`, `this`. Cheile noastre (`customer_first_name`, `support_email`, etc.) sunt în regulă.

## Verificare rapidă

Cu `RESEND_API_KEY` și `RESEND_FROM_EMAIL` setate, rulează testele de integrare (vezi `tests/integration/notifications-processor.integration.test.ts`) sau trimiterea manuală din Resend cu „Send test”.

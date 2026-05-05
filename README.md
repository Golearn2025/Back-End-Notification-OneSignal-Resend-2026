# backend-notifications

Internal notifications service foundation for Vantage Lane.

## Scope (Phase 1)
- Project foundation only
- Modular folder structure
- Strict TypeScript setup
- Fastify app bootstrap + `/health`
- Worker bootstrap separated from HTTP server
- Env validation via Zod
- Logger setup via Pino
- Stub modules for notifications/realtime/providers/workers

## Out of scope (Phase 1)
- No real OneSignal sending
- No real Resend sending
- No production flow integration
- No database migrations applied
- No Supabase modifications

## Planned flow (target architecture)
1. Realtime listener detects new `notification_events`
2. Polling worker recovers missed/pending events
3. Router decides channels using preferences/devices
4. Dispatcher delegates to channel providers
5. Delivery states tracked in `notification_deliveries`
6. In-app inbox remains `notifications`

## Module responsibilities
- `modules/notifications`: orchestration contracts and stubs
- `modules/realtime`: Supabase realtime listener skeleton
- `modules/worker`: polling/retry manager skeleton
- `modules/providers`: OneSignal/Resend provider interfaces (non-sending stubs)
- `modules/devices`: current `driver_devices` source abstraction
- `modules/preferences`: current `driver_notification_preferences` abstraction
- `modules/inbox`: current `notifications` source abstraction
- `modules/security`: internal auth plugin using `INTERNAL_API_SECRET`

## Resend (template-uri HTML)

Aliasurile și variabilele trebuie să coincidă cu `ResendProvider`. HTML gata de import în dashboard: vezi [`docs/resend-templates/`](docs/resend-templates/README.md).

Variabile Resend în env: `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (trimitere); opțional `RESEND_TEMPLATE_AUDIT_API_KEY` (cheie separată pentru API-ul de template-uri, ex. scope restricționat).

## Local commands
- `npm install`
- `npm run validate-env`
- `npm run typecheck`
- `npm test`
- `npm run dev`
- `WORKER_ENABLED=false npm run dev:worker`

## Worker startup runbook (stable)

Use these steps to ensure worker realtime always starts with a clean env.

### Local (recommended)
1. Load `.env` in the current shell:
   - `set -a && source .env && set +a`
2. Start worker in clean realtime mode:
   - `npm run dev:worker:loop:clean`
3. Confirm startup logs contain:
   - `Realtime worker configuration` with:
     - `realtimeEnabled: true`
     - `realtimeDisableProxy: false`
     - `realtimeAuthSource: SUPABASE_SERVICE_ROLE_KEY`
   - `Realtime listener subscribed`

### Why this avoids flaky behavior
- It unsets `SUPABASE_REALTIME_KEY` for the process, so stale shell values cannot override runtime.
- Worker still keeps polling fallback (`WORKER_POLL_INTERVAL_MS=30000`) for resilience.

## Render deployment checklist

For production, set env vars in Render service settings (single source of truth):
- Required:
  - `NODE_ENV=production`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `WORKER_ENABLED=true`
  - `WORKER_MODE=loop`
  - `WORKER_POLL_INTERVAL_MS=30000`
  - `SUPABASE_REALTIME_ENABLED=true`
  - `SUPABASE_REALTIME_CHANNEL=notification-events`
  - `RESEND_API_KEY`
  - `RESEND_FROM_EMAIL`
  - `ONESIGNAL_APP_ID`
  - `ONESIGNAL_REST_API_KEY`
- Recommended:
  - do not set `SUPABASE_REALTIME_KEY` unless strictly needed
  - keep `SUPABASE_REALTIME_DISABLE_PROXY` unset (or explicitly `false`)

Suggested start command for worker service on Render:
- `npm run build && node dist/worker.js`
- Blueprint option:
  - use `render.yaml` from repo root (`backend-notifications/render.yaml`) to create both API and worker services with safe defaults.

Post-deploy verification:
1. Check logs for `Realtime worker configuration` and `Realtime listener subscribed`.
2. Run one `pending -> succeeded` booking payment test.
3. Confirm immediate logs:
   - `Realtime wake-up event received`
   - `Worker wake-up requested`
4. Confirm DB deliveries reach `provider_accepted`.

## Roadmap
1. project foundation
2. migration proposal for notification_events and notification_deliveries
3. realtime + polling skeleton
4. fake event processing
5. OneSignal integration
6. Resend integration
7. first real event: booking_created
8. driver_assigned
9. admin/customer notifications

## Next step checklist
- [ ] Review and approve module boundaries
- [ ] Define event schema contract for `notification_events`
- [ ] Define delivery state model for `notification_deliveries`
- [ ] Add internal routes behind auth plugin
- [ ] Implement fake processing for local end-to-end dry runs

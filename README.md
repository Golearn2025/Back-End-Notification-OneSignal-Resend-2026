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

## Local commands
- `npm install`
- `npm run validate-env`
- `npm run typecheck`
- `npm test`
- `npm run dev`
- `WORKER_ENABLED=false npm run dev:worker`

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

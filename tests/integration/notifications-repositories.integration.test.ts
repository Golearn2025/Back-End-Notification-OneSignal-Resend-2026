import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationDeliveriesRepository } from '../../src/modules/notifications/notification-deliveries.repository.js';
import { NotificationEventsRepository } from '../../src/modules/notifications/notification-events.repository.js';
import {
  createServiceRoleClient,
  fetchFirstOrganizationId,
  hasSupabaseCredentials,
  loadBackendEnvFromProcess
} from './integration-env.js';

describe.skipIf(!hasSupabaseCredentials())('notification repositories (Supabase integration)', () => {
  let orgId: string;
  let client: ReturnType<typeof createServiceRoleClient>;
  const createdEventIds: string[] = [];
  const createdDeliveryIds: string[] = [];

  beforeAll(async () => {
    loadBackendEnvFromProcess();
    client = createServiceRoleClient();
    orgId = await fetchFirstOrganizationId(client);
  });

  afterAll(async () => {
    if (createdDeliveryIds.length > 0) {
      await client.from('notification_deliveries').delete().in('id', createdDeliveryIds);
    }
    if (createdEventIds.length > 0) {
      await client.from('notification_events').delete().in('id', createdEventIds);
    }
  });

  it('creates a notification_event and reads it back', async () => {
    const repo = new NotificationEventsRepository();
    const idempotencyKey = `integration:repo:${randomUUID()}`;
    const row = await repo.createEvent({
      organization_id: orgId,
      event_type: 'booking_confirmed',
      source_module: 'integration_test',
      priority: 'normal',
      idempotency_key: idempotencyKey,
      payload: { note: 'integration' }
    });
    createdEventIds.push(row.id);
    expect(row.organization_id).toBe(orgId);
    expect(row.status).toBe('pending');

    const { data, error } = await client.from('notification_events').select('id').eq('id', row.id).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(row.id);
  });

  it('getPendingEvents returns an array (live query)', async () => {
    const repo = new NotificationEventsRepository();
    const rows = await repo.getPendingEvents(5);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('creates notification_delivery linked to an event', async () => {
    const eventsRepo = new NotificationEventsRepository();
    const deliveriesRepo = new NotificationDeliveriesRepository();
    const idempotencyKey = `integration:delivery:${randomUUID()}`;
    const event = await eventsRepo.createEvent({
      organization_id: orgId,
      event_type: 'booking_confirmed',
      source_module: 'integration_test',
      idempotency_key: idempotencyKey,
      payload: {}
    });
    createdEventIds.push(event.id);

    const delivery = await deliveriesRepo.createDelivery({
      organization_id: orgId,
      event_id: event.id,
      recipient_type: 'system',
      recipient_selection: 'system_generated',
      channel: 'email',
      provider: 'internal',
      status: 'queued',
      max_attempts: 1,
      metadata: { integration: true }
    });
    createdDeliveryIds.push(delivery.id);
    expect(delivery.event_id).toBe(event.id);
  });
});

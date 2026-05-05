import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationProcessorService } from '../../src/modules/notifications/notification-processor.service.js';
import { NotificationDeliveriesRepository } from '../../src/modules/notifications/notification-deliveries.repository.js';
import { NotificationEventsRepository } from '../../src/modules/notifications/notification-events.repository.js';
import { ResendProvider } from '../../src/modules/providers/resend.provider.js';
import {
  createServiceRoleClient,
  fetchFirstOrganizationId,
  hasResendCredentials,
  hasSupabaseCredentials,
  loadBackendEnvFromProcess
} from './integration-env.js';

describe.skipIf(!hasSupabaseCredentials() || !hasResendCredentials())(
  'NotificationProcessorService → Resend (live integration)',
  () => {
    let orgId: string;
    let client: ReturnType<typeof createServiceRoleClient>;
    const createdEventIds: string[] = [];

    beforeAll(async () => {
      loadBackendEnvFromProcess();
      client = createServiceRoleClient();
      orgId = await fetchFirstOrganizationId(client);
    });

    afterAll(async () => {
      if (createdEventIds.length === 0) {
        return;
      }
      await client.from('notification_deliveries').delete().in('event_id', createdEventIds);
      await client.from('notification_events').delete().in('id', createdEventIds);
    });

    it(
      'processes customer_account_created and records provider_accepted delivery',
      async () => {
        const eventsRepo = new NotificationEventsRepository();
        const deliveriesRepo = new NotificationDeliveriesRepository();
        const idempotencyKey = `integration:processor:welcome:${randomUUID()}`;
        const event = await eventsRepo.createEvent({
          organization_id: orgId,
          event_type: 'customer_account_created',
          source_module: 'integration_test',
          idempotency_key: idempotencyKey,
          customer_id: null,
          payload: {
            customer_email: process.env.INTEGRATION_TEST_EMAIL ?? 'info@vantage-lane.com',
            customer_first_name: 'Integration'
          }
        });
        createdEventIds.push(event.id);

        const processor = new NotificationProcessorService(eventsRepo, deliveriesRepo, new ResendProvider());
        await processor.process(event);

        const { data: deliveries, error } = await client
          .from('notification_deliveries')
          .select('id,status,provider_message_id')
          .eq('event_id', event.id);
        expect(error).toBeNull();
        expect(deliveries?.length).toBeGreaterThanOrEqual(1);
        const emailRow = deliveries?.find((d) => d.status === 'provider_accepted');
        expect(emailRow?.provider_message_id).toBeTruthy();
      },
      120_000
    );

    it(
      'processes booking_payment_confirmed and records Resend deliveries',
      async () => {
        const eventsRepo = new NotificationEventsRepository();
        const deliveriesRepo = new NotificationDeliveriesRepository();
        const testEmail = process.env.INTEGRATION_TEST_EMAIL ?? 'info@vantage-lane.com';
        const idempotencyKey = `integration:processor:payment:${randomUUID()}`;
        const event = await eventsRepo.createEvent({
          organization_id: orgId,
          event_type: 'booking_payment_confirmed',
          source_module: 'integration_test',
          idempotency_key: idempotencyKey,
          customer_id: null,
          payload: {
            customer_email: testEmail,
            customer_first_name: 'Integration',
            invoice_number: 'INV-INT-0001',
            payment_date: '5 May 2026',
            payment_method: 'Visa •••• 4242',
            amount_paid: '10.00',
            currency: 'GBP',
            receipt_url: 'https://vantage-lane.com',
            booking_line_1_label: 'Booking Type',
            booking_line_1_value: 'One Way',
            booking_line_2_label: 'Reference',
            booking_line_2_value: 'CB-INT-001',
            booking_line_3_label: 'When',
            booking_line_3_value: '5 May 2026, 12:00',
            booking_line_4_label: 'Route',
            booking_line_4_value: 'A → B',
            booking_line_5_label: 'Vehicle',
            booking_line_5_value: 'Executive',
            booking_line_6_label: 'Passengers',
            booking_line_6_value: '1',
            context_source: 'integration_test'
          }
        });
        createdEventIds.push(event.id);

        const processor = new NotificationProcessorService(eventsRepo, deliveriesRepo, new ResendProvider());
        await processor.process(event);

        const { data: deliveries, error } = await client
          .from('notification_deliveries')
          .select('id,status,recipient_type')
          .eq('event_id', event.id)
          .order('created_at', { ascending: true });
        expect(error).toBeNull();
        expect(deliveries?.length).toBeGreaterThanOrEqual(2);
        const accepted = deliveries?.filter((d) => d.status === 'provider_accepted') ?? [];
        expect(accepted.length).toBeGreaterThanOrEqual(1);
        expect(deliveries?.some((d) => d.recipient_type === 'customer')).toBe(true);
        expect(deliveries?.some((d) => d.recipient_type === 'jobs_mailbox')).toBe(true);
      },
      120_000
    );
  }
);

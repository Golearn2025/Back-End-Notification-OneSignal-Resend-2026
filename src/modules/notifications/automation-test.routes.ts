/**
 * Internal test endpoints — pinned to test@vantage-lane.com by default.
 * Use these to mock automations without enabling org-wide cron.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getSupabaseAdmin } from '../../config/supabase.js';
import { logger } from '../../config/logger.js';
import { ResendProvider } from '../providers/resend.provider.js';
import { OneSignalProvider } from '../providers/onesignal.provider.js';
import { NotificationEventsRepository } from './notification-events.repository.js';
import { NotificationDeliveriesRepository } from './notification-deliveries.repository.js';
import {
  AUTOMATION_TEST_DRIVER,
  buildAccountStatusPushCopy,
  buildDocExpiryPushCopy,
  buildJobReminderPushCopy,
  labelDocumentType
} from './automation-test.constants.js';
import { DEFAULT_SUPPORT_EMAIL } from './notification-shared.js';

const optionalOverrideSchema = z
  .object({
    /** If true, allow non-test driver (still requires explicit driverId). Default false. */
    allowNonTestDriver: z.boolean().optional(),
    driverId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
    dryRun: z.boolean().optional()
  })
  .optional();

async function resolveTarget(body: z.infer<typeof optionalOverrideSchema> | undefined) {
  const allow = body?.allowNonTestDriver === true;
  if (!allow) {
    return { ...AUTOMATION_TEST_DRIVER };
  }
  if (!body?.driverId || !body.organizationId) {
    throw new Error('allowNonTestDriver requires driverId and organizationId');
  }
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('drivers')
    .select('id, organization_id, email, first_name, last_name, auth_user_id')
    .eq('id', body.driverId)
    .eq('organization_id', body.organizationId)
    .maybeSingle();
  const row = data as {
    id?: string;
    organization_id?: string;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    auth_user_id?: string | null;
  } | null;
  if (error || !row?.auth_user_id || !row.id || !row.organization_id) {
    throw new Error(error?.message ?? 'driver not found or missing auth_user_id');
  }
  return {
    email: String(row.email ?? ''),
    driverId: String(row.id),
    organizationId: String(row.organization_id),
    authUserId: String(row.auth_user_id),
    firstName: String(row.first_name ?? 'Driver'),
    lastName: String(row.last_name ?? '')
  };
}

async function enqueueAdminDriverPush(input: {
  organizationId: string;
  driverId: string;
  authUserId: string;
  eventType: 'admin_driver_documents' | 'admin_driver_jobs' | 'admin_driver_system';
  title: string;
  body: string;
  inboxType: string;
  deepLink: string;
  jobId?: string | null;
  extraPayload?: Record<string, unknown>;
  sourceModule: string;
  idempotencyKey: string;
}): Promise<{ eventId: string; inboxOk: boolean }> {
  const eventsRepository = new NotificationEventsRepository();
  const db = getSupabaseAdmin();

  // Inbox only (no second notification_events row — avoids double push)
  const { error: inboxError } = await (db as any).rpc('enqueue_driver_inbox_message', {
    p_auth_user_id: input.authUserId,
    p_organization_id: input.organizationId,
    p_title: input.title,
    p_message: input.body,
    p_type: input.inboxType
  });

  if (inboxError) {
    logger.warn({ err: inboxError.message }, 'automation-test: inbox insert failed');
  }

  const event = await eventsRepository.createEvent({
    organization_id: input.organizationId,
    event_type: input.eventType,
    source_module: input.sourceModule,
    priority: 'normal',
    idempotency_key: input.idempotencyKey,
    driver_id: input.driverId,
    job_id: input.jobId ?? null,
    payload: {
      event_type: input.eventType,
      category:
        input.eventType === 'admin_driver_documents'
          ? 'documents'
          : input.eventType === 'admin_driver_jobs'
            ? 'jobs'
            : 'system',
      section:
        input.eventType === 'admin_driver_documents' ? 'documents' : 'updates',
      inbox_type: input.inboxType,
      push_title: input.title,
      push_body: input.body,
      message: input.body,
      deep_link: input.deepLink,
      channels: ['push', 'inbox'],
      ...(input.extraPayload ?? {})
    }
  });

  return { eventId: event.id, inboxOk: !inboxError };
}

export async function registerAutomationTestRoutes(app: FastifyInstance) {
  app.get('/notifications/test/automation-target', async (_request, reply) => {
    return reply.send({
      target: AUTOMATION_TEST_DRIVER,
      note: 'All automation mock POSTs default to this driver unless allowNonTestDriver=true'
    });
  });

  app.post('/notifications/test/doc-expiry-mock', async (request, reply) => {
    const schema = z.object({
      daysLeft: z.union([z.literal(30), z.literal(15), z.literal(1), z.literal(0)]).default(30),
      documentType: z.string().default('driving_licence'),
      expiryDate: z.string().optional(),
      sendEmail: z.boolean().default(true),
      sendPush: z.boolean().default(true),
      dryRun: z.boolean().optional(),
      allowNonTestDriver: z.boolean().optional(),
      driverId: z.string().uuid().optional(),
      organizationId: z.string().uuid().optional()
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    let target;
    try {
      target = await resolveTarget(parsed.data);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'bad target' });
    }

    const documentLabel = labelDocumentType(parsed.data.documentType);
    const expiry =
      parsed.data.expiryDate ??
      new Date(Date.now() + parsed.data.daysLeft * 86400000).toISOString().slice(0, 10);
    const copy = buildDocExpiryPushCopy({
      daysLeft: parsed.data.daysLeft,
      documentLabel,
      expiryDate: expiry
    });

    const preview = {
      targetEmail: target.email,
      driverId: target.driverId,
      copy,
      channels: {
        push: parsed.data.sendPush,
        email: parsed.data.sendEmail,
        inbox: true
      }
    };

    if (parsed.data.dryRun) {
      return reply.send({ dryRun: true, ...preview });
    }

    const { eventId, inboxOk } = await enqueueAdminDriverPush({
      organizationId: target.organizationId,
      driverId: target.driverId,
      authUserId: target.authUserId,
      eventType: 'admin_driver_documents',
      title: copy.title,
      body: copy.body,
      inboxType: copy.inbox_type,
      deepLink: copy.deep_link,
      sourceModule: 'automation_test_doc_expiry',
      idempotencyKey: `test_doc_expiry:${target.driverId}:${parsed.data.daysLeft}:${Date.now()}`,
      extraPayload: {
        document_type: parsed.data.documentType,
        days_left: parsed.data.daysLeft,
        expiry_date: expiry
      }
    });

    let emailId: string | null = null;
    if (parsed.data.sendEmail) {
      const resend = new ResendProvider();
      const result = await resend.sendDriverDocumentExpiringEmail({
        to: target.email,
        driverFirstName: target.firstName,
        documentLabel,
        expiryDate: expiry,
        daysLeft: parsed.data.daysLeft,
        headline: copy.title,
        bodyText: copy.body,
        supportEmail: DEFAULT_SUPPORT_EMAIL
      });
      emailId = result.providerMessageId;
    }

    // Push is delivered by polling worker from the pending event
    return reply.code(201).send({
      ...preview,
      eventId,
      inboxOk,
      emailId,
      note: 'Push will send when notification worker polls pending admin_driver_documents events'
    });
  });

  app.post('/notifications/test/job-reminder-mock', async (request, reply) => {
    const schema = z.object({
      minutesBefore: z.union([z.literal(180), z.literal(60)]).default(180),
      pickupTime: z.string().default('14:30'),
      fromShort: z.string().default('Heathrow T5'),
      toShort: z.string().default('Mayfair'),
      jobId: z.string().uuid().optional(),
      dryRun: z.boolean().optional(),
      allowNonTestDriver: z.boolean().optional(),
      driverId: z.string().uuid().optional(),
      organizationId: z.string().uuid().optional()
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    let target;
    try {
      target = await resolveTarget(parsed.data);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'bad target' });
    }

    const copy = buildJobReminderPushCopy({
      minutesBefore: parsed.data.minutesBefore,
      pickupTime: parsed.data.pickupTime,
      fromShort: parsed.data.fromShort,
      toShort: parsed.data.toShort
    });

    const preview = {
      targetEmail: target.email,
      driverId: target.driverId,
      copy,
      jobId: parsed.data.jobId ?? null,
      channels: { push: true, email: false, inbox: true }
    };

    if (parsed.data.dryRun) {
      return reply.send({ dryRun: true, ...preview });
    }

    const { eventId, inboxOk } = await enqueueAdminDriverPush({
      organizationId: target.organizationId,
      driverId: target.driverId,
      authUserId: target.authUserId,
      eventType: 'admin_driver_jobs',
      title: copy.title,
      body: copy.body,
      inboxType: copy.inbox_type,
      deepLink: copy.deep_link,
      jobId: parsed.data.jobId ?? null,
      sourceModule: 'automation_test_job_reminder',
      idempotencyKey: `test_job_reminder:${target.driverId}:${parsed.data.minutesBefore}:${Date.now()}`,
      extraPayload: {
        minutes_before: parsed.data.minutesBefore,
        job_id: parsed.data.jobId ?? null
      }
    });

    return reply.code(201).send({
      ...preview,
      eventId,
      inboxOk,
      note: 'No email for job reminders. Push via worker; tap should open Accepted when job_id present.'
    });
  });

  app.post('/notifications/test/account-status-mock', async (request, reply) => {
    const schema = z.object({
      kind: z.enum(['approved', 'rejected', 'suspended', 'reactivated']),
      dryRun: z.boolean().optional(),
      allowNonTestDriver: z.boolean().optional(),
      driverId: z.string().uuid().optional(),
      organizationId: z.string().uuid().optional()
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    let target;
    try {
      target = await resolveTarget(parsed.data);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'bad target' });
    }

    const copy = buildAccountStatusPushCopy(parsed.data.kind);
    const preview = { targetEmail: target.email, driverId: target.driverId, kind: parsed.data.kind, copy };

    if (parsed.data.dryRun) {
      return reply.send({ dryRun: true, ...preview });
    }

    const { eventId, inboxOk } = await enqueueAdminDriverPush({
      organizationId: target.organizationId,
      driverId: target.driverId,
      authUserId: target.authUserId,
      eventType: 'admin_driver_system',
      title: copy.title,
      body: copy.body,
      inboxType: copy.inbox_type,
      deepLink: copy.deep_link,
      sourceModule: 'automation_test_account_status',
      idempotencyKey: `test_account:${parsed.data.kind}:${target.driverId}:${Date.now()}`
    });

    return reply.code(201).send({ ...preview, eventId, inboxOk });
  });

  /** Immediate OneSignal push (bypass worker) — still pinned to test driver by default */
  app.post('/notifications/test/automation-push-now', async (request, reply) => {
    const schema = z.object({
      title: z.string().min(1),
      message: z.string().min(1),
      deepLink: z.string().optional(),
      inboxType: z.string().optional(),
      jobId: z.string().uuid().optional(),
      allowNonTestDriver: z.boolean().optional(),
      driverId: z.string().uuid().optional(),
      organizationId: z.string().uuid().optional()
    });
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    let target;
    try {
      target = await resolveTarget(parsed.data);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'bad target' });
    }

    const eventsRepository = new NotificationEventsRepository();
    const deliveriesRepository = new NotificationDeliveriesRepository();
    const oneSignal = new OneSignalProvider();

    const event = await eventsRepository.createEvent({
      organization_id: target.organizationId,
      event_type: 'admin_driver_system',
      source_module: 'automation_test_push_now',
      priority: 'high',
      idempotency_key: `test_push_now:${target.driverId}:${Date.now()}`,
      driver_id: target.driverId,
      job_id: parsed.data.jobId ?? null,
      payload: {
        push_title: parsed.data.title,
        push_body: parsed.data.message,
        deep_link: parsed.data.deepLink ?? 'notifications',
        inbox_type: parsed.data.inboxType ?? 'system'
      }
    });

    const delivery = await deliveriesRepository.createDelivery({
      organization_id: target.organizationId,
      event_id: event.id,
      recipient_type: 'driver',
      recipient_selection: 'assigned_driver',
      recipient_id: target.driverId,
      recipient_address: target.authUserId,
      channel: 'push',
      provider: 'onesignal',
      status: 'queued',
      max_attempts: 3
    });

    try {
      await deliveriesRepository.markDeliverySending(delivery.id);
      const result = await oneSignal.sendPushToExternalUserId({
        externalUserId: target.authUserId,
        title: parsed.data.title,
        message: parsed.data.message,
        data: {
          event_type: 'admin_driver_system',
          deep_link: parsed.data.deepLink ?? 'notifications',
          inbox_type: parsed.data.inboxType ?? 'system',
          driver_id: target.driverId,
          ...(parsed.data.jobId ? { job_id: parsed.data.jobId } : {})
        }
      });
      await deliveriesRepository.markDeliveryProviderAccepted(delivery.id, result.providerMessageId, {
        provider: 'onesignal'
      });
      await eventsRepository.markEventDelivered(event.id);
      return reply.code(201).send({
        targetEmail: target.email,
        eventId: event.id,
        deliveryId: delivery.id,
        providerMessageId: result.providerMessageId
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'push failed';
      const nextRetry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await deliveriesRepository.markDeliveryFailedRetryable(delivery.id, reason, nextRetry);
      await eventsRepository.markEventFailedRetryable(event.id, reason, nextRetry);
      return reply.code(502).send({ error: reason, eventId: event.id });
    }
  });
}

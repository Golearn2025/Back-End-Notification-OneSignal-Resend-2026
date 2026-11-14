import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processAdminDriverNotificationBatch } from '../../src/modules/notifications/handlers/process-admin-driver-notification-batch.js';
import { NotificationDeliveriesRepository } from '../../src/modules/notifications/notification-deliveries.repository.js';
import { NotificationEventsRepository } from '../../src/modules/notifications/notification-events.repository.js';
import { isOneSignalIdempotencyKey } from '../../src/modules/notifications/onesignal-idempotency.js';
import { PgCountClient } from './pg-count-client.js';

/**
 * Timed path on isolated Postgres (not the in-memory adapter):
 * Admin-equivalent campaign RPC → claim → handler prep → fake provider.
 */
describe('timed campaign 100 on isolated Postgres', () => {
  const root = process.cwd();
  const fixturePath = join(root, 'tests/migrations/fixtures/admin_campaign_008_schema.sql');
  const migrationPath = join(root, 'migrations/20261114_008_admin_campaign_enqueue.sql');
  const adminUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? 'postgresql://localhost/postgres';
  const dbName = `notif_bench_${randomBytes(3).toString('hex')}`;
  let dbUrl = '';
  let pool: pg.Pool | null = null;
  let skip = false;

  const runPsql = (url: string, args: string[]) =>
    execFileSync('psql', [url, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  beforeAll(async () => {
    if (!existsSync(fixturePath) || !existsSync(migrationPath)) {
      skip = true;
      return;
    }
    try {
      execFileSync('psql', ['--version'], { stdio: 'pipe' });
      runPsql(adminUrl, ['-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${dbName}`]);
    } catch (error) {
      console.warn(`skipping timed campaign bench: ${error}`);
      skip = true;
      return;
    }
    dbUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
    runPsql(dbUrl, ['-v', 'ON_ERROR_STOP=1', '-f', fixturePath]);
    runPsql(dbUrl, ['-v', 'ON_ERROR_STOP=1', '-f', migrationPath]);
    pool = new pg.Pool({ connectionString: dbUrl });
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (!skip) {
      try {
        runPsql(adminUrl, ['-c', `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
      } catch {
        try {
          runPsql(adminUrl, ['-c', `DROP DATABASE IF EXISTS ${dbName}`]);
        } catch {
          /* ignore */
        }
      }
    }
  });

  it('reports enqueue / pickup / prep / provider timings for 100 recipients', async () => {
    if (skip || !pool) {
      console.warn('timed campaign bench skipped');
      return;
    }

    const orgId = randomUUID();
    const actorId = randomUUID();
    const driverIds: string[] = [];
    await pool.query(`INSERT INTO public.organizations(id, name) VALUES ($1, 'bench')`, [orgId]);
    for (let i = 0; i < 100; i += 1) {
      const driverId = randomUUID();
      const authId = randomUUID();
      driverIds.push(driverId);
      await pool.query(
        `INSERT INTO public.drivers(id, organization_id, auth_user_id) VALUES ($1,$2,$3)`,
        [driverId, orgId, authId]
      );
    }

    // --- enqueue (Admin route equivalent: one campaign RPC) ---
    const enqueueStarted = performance.now();
    const enqueueResult = await pool.query(
      `SELECT public.admin_enqueue_driver_notification_campaign($1::uuid, $2::uuid[], $3::text, $4::text, $5::text, $6::uuid) AS campaign_id`,
      [orgId, driverIds, 'admin_message', 'Fleet notice', 'Please confirm receipt', actorId]
    );
    const enqueueMs = performance.now() - enqueueStarted;
    const campaignId = enqueueResult.rows[0].campaign_id as string;

    const inboxCount = Number(
      (await pool.query(`SELECT count(*)::int AS n FROM public.driver_inbox_messages`)).rows[0].n
    );
    expect(inboxCount).toBe(100);

    // --- pickup wait ---
    const pickupStarted = performance.now();
    let pendingRows = (
      await pool.query(
        `SELECT * FROM public.notification_events
         WHERE payload->>'campaign_id' = $1 AND status = 'pending'
         ORDER BY occurred_at ASC`,
        [campaignId]
      )
    ).rows;
    const pickupWaitMs = performance.now() - pickupStarted;
    expect(pendingRows.length).toBe(100);

    // --- claim (worker) ---
    const claimStarted = performance.now();
    const claimed = (
      await pool.query(
        `UPDATE public.notification_events
         SET status = 'processing', processing_started_at = now(), updated_at = now()
         WHERE payload->>'campaign_id' = $1 AND status = 'pending'
         RETURNING *`,
        [campaignId]
      )
    ).rows;
    const claimMs = performance.now() - claimStarted;
    expect(claimed.length).toBe(100);

    // --- prep + provider (handler with counting Postgres client) ---
    const db = new PgCountClient(pool);
    const eventsRepository = new NotificationEventsRepository(db as any);
    const deliveriesRepository = new NotificationDeliveriesRepository(db as any);

    const providerCalls: Array<{ audience: string[]; key: string }> = [];
    let providerHitAt: number | null = null;
    let dbQueriesAtProvider: number | null = null;

    const prepStarted = performance.now();
    await processAdminDriverNotificationBatch({
      events: claimed as any,
      eventsRepository,
      deliveriesRepository,
      oneSignal: {
        sendPushToExternalUserIds: async (input: {
          externalUserIds: string[];
          idempotencyKey?: string;
        }) => {
          providerHitAt = performance.now();
          dbQueriesAtProvider = db.queryCount;
          const key = String(input.idempotencyKey ?? '');
          if (!isOneSignalIdempotencyKey(key)) {
            throw new Error('idempotency_key must be UUID');
          }
          providerCalls.push({ audience: [...input.externalUserIds].sort(), key });
          return {
            providerMessageId: `os-${key.slice(0, 8)}`,
            idempotencyKey: key,
            responseMetadata: { invalidExternalIds: [] }
          };
        }
      } as any,
      db: db as any
    });
    const totalHandlerMs = performance.now() - prepStarted;
    const prepMs = providerHitAt == null ? totalHandlerMs : providerHitAt - prepStarted;
    const timeToProviderMs = prepMs;
    const prepDbQueriesBeforeProvider = dbQueriesAtProvider ?? db.queryCount;
    const totalDbQueriesIncludingPersist = db.queryCount;

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.audience).toHaveLength(100);

    const delivered = Number(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM public.notification_events
           WHERE payload->>'campaign_id' = $1 AND status = 'delivered'`,
          [campaignId]
        )
      ).rows[0].n
    );
    const deliveries = Number(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM public.notification_deliveries WHERE status = 'provider_accepted'`
        )
      ).rows[0].n
    );
    expect(delivered).toBe(100);
    expect(deliveries).toBe(100);

    const report = {
      recipients: 100,
      enqueueMs: Number(enqueueMs.toFixed(2)),
      pickupWaitMs: Number(pickupWaitMs.toFixed(2)),
      claimMs: Number(claimMs.toFixed(2)),
      prepMs: Number(prepMs.toFixed(2)),
      timeToProviderMs: Number((timeToProviderMs ?? 0).toFixed(2)),
      totalHandlerMs: Number(totalHandlerMs.toFixed(2)),
      prepDbQueriesBeforeProvider,
      totalDbQueriesIncludingPersist,
      providerCalls: providerCalls.length,
      audienceSize: providerCalls[0]?.audience.length ?? 0,
      note: 'Isolated Postgres + fake provider; not in-memory adapter timings.'
    };
    // eslint-disable-next-line no-console
    console.log('CAMPAIGN_100_TIMED_REPORT', JSON.stringify(report, null, 2));

    expect(report.audienceSize).toBe(100);
    expect(report.providerCalls).toBe(1);
    expect(report.prepDbQueriesBeforeProvider).toBeLessThan(40);
  });
});

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Applies real 008 over a schema that already has the live 6-arg RPC,
 * then verifies both overloads + service_role-only grants.
 */
describe('migration 008 real apply (compat + auth)', () => {
  const root = process.cwd();
  const fixturePath = join(root, 'tests/migrations/fixtures/admin_campaign_008_schema.sql');
  const migrationPath = join(root, 'migrations/20261114_008_admin_campaign_enqueue.sql');

  it('keeps 6-arg RPC and locks EXECUTE to service_role', () => {
    if (!existsSync(fixturePath) || !existsSync(migrationPath)) {
      throw new Error('missing fixture or migration 008');
    }

    try {
      execFileSync('psql', ['--version'], { stdio: 'pipe' });
    } catch {
      console.warn('psql unavailable — skipping 008 apply test');
      return;
    }

    const dbName = `notif_008_${randomBytes(4).toString('hex')}`;
    const adminUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? 'postgresql://localhost/postgres';
    const run = (args: string[]) =>
      execFileSync('psql', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    try {
      run([adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${dbName}`]);
    } catch (error) {
      console.warn(`could not create isolated DB — skipping (${error})`);
      return;
    }

    const dbUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);

    try {
      run([dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', fixturePath]);
      run([dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', migrationPath]);

      const sigs = run([
        dbUrl,
        '-t',
        '-A',
        '-c',
        `
        SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ' ORDER BY pronargs)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='admin_enqueue_driver_notification';
        `
      ]).trim();
      expect(sigs).toContain('p_organization_id uuid, p_driver_id uuid, p_type text, p_title text, p_body text, p_actor_id uuid');
      expect(sigs).toContain('p_campaign_id uuid');

      const grants = run([
        dbUrl,
        '-t',
        '-A',
        '-c',
        `
        SELECT
          has_function_privilege('service_role', 'public.admin_enqueue_driver_notification(uuid,uuid,text,text,text,uuid)', 'EXECUTE')::text
          || ',' ||
          has_function_privilege('service_role', 'public.admin_enqueue_driver_notification(uuid,uuid,text,text,text,uuid,uuid)', 'EXECUTE')::text
          || ',' ||
          has_function_privilege('service_role', 'public.admin_enqueue_driver_notification_campaign(uuid,uuid[],text,text,text,uuid)', 'EXECUTE')::text
          || ',' ||
          (NOT has_function_privilege('public', 'public.admin_enqueue_driver_notification_campaign(uuid,uuid[],text,text,text,uuid)', 'EXECUTE'))::text
          || ',' ||
          (NOT has_function_privilege('authenticated', 'public.admin_enqueue_driver_notification_campaign(uuid,uuid[],text,text,text,uuid)', 'EXECUTE'))::text;
        `
      ]).trim();
      expect(grants).toBe('true,true,true,true,true');

      // 6-arg still callable after 008.
      const six = run([
        dbUrl,
        '-v',
        'ON_ERROR_STOP=1',
        '-t',
        '-A',
        '-c',
        `
        INSERT INTO public.organizations(id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org');
        INSERT INTO public.drivers(id, organization_id, auth_user_id)
        VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
        SELECT public.admin_enqueue_driver_notification(
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
          'admin_message'::text,
          'Hello'::text,
          'Body'::text,
          NULL::uuid
        ) IS NOT NULL;
        `
      ]).trim();
      expect(six).toBe('t');
    } finally {
      try {
        run([adminUrl, '-c', `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
      } catch {
        try {
          run([adminUrl, '-c', `DROP DATABASE IF EXISTS ${dbName}`]);
        } catch {
          /* ignore */
        }
      }
    }
  });
});

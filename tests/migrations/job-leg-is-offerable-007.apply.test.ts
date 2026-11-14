import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Applies the REAL migration file 20261114_007_job_leg_is_offerable_minimal.sql
 * in an isolated Postgres database (not the in-schema recreation smoke test).
 *
 * Requires local `psql` + a superuser connection via DATABASE_URL or defaults
 * to postgresql://localhost/postgres.
 */
describe('migration 007 real apply (isolated Postgres)', () => {
  const migrationPath = join(
    process.cwd(),
    'migrations/20261114_007_job_leg_is_offerable_minimal.sql'
  );

  it('executes the real SQL file and verifies function + grants', () => {
    if (!existsSync(migrationPath)) {
      throw new Error(`missing migration file: ${migrationPath}`);
    }

    let psqlOk = false;
    try {
      execFileSync('psql', ['--version'], { stdio: 'pipe' });
      psqlOk = true;
    } catch {
      psqlOk = false;
    }
    if (!psqlOk) {
      // Soft-skip when psql is unavailable in CI without Postgres client.
      console.warn('psql unavailable — skipping isolated 007 apply test');
      return;
    }

    const dbName = `notif_007_${randomBytes(4).toString('hex')}`;
    const adminUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? 'postgresql://localhost/postgres';

    const run = (args: string[], input?: string) =>
      execFileSync('psql', args, {
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

    try {
      run([adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${dbName}`]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`could not create isolated DB (${msg}) — skipping 007 apply test`);
      return;
    }

    const dbUrl = adminUrl.replace(/\/[^/]+(\?|$)/, `/${dbName}$1`);

    try {
      // Roles referenced by the real migration grants.
      run([
        dbUrl,
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `
        DO $$ BEGIN
          CREATE ROLE service_role NOLOGIN;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        CREATE TABLE public.booking_legs (
          id uuid PRIMARY KEY,
          status text NOT NULL,
          assigned_driver_id uuid NULL,
          deleted_at timestamptz NULL
        );
        `
      ]);

      const sql = readFileSync(migrationPath, 'utf8');
      run([dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', migrationPath], sql);

      const verify = run([
        dbUrl,
        '-v',
        'ON_ERROR_STOP=1',
        '-t',
        '-A',
        '-c',
        `
        SELECT
          (to_regprocedure('public.job_leg_is_offerable(uuid)') IS NOT NULL)::text
          || ',' ||
          has_function_privilege('service_role', 'public.job_leg_is_offerable(uuid)', 'EXECUTE')::text
          || ',' ||
          has_function_privilege('postgres', 'public.job_leg_is_offerable(uuid)', 'EXECUTE')::text
          || ',' ||
          (NOT has_function_privilege('public', 'public.job_leg_is_offerable(uuid)', 'EXECUTE'))::text;
        `
      ]).trim();

      // exists, service_role EXECUTE, postgres EXECUTE, PUBLIC revoked
      expect(verify).toBe('true,true,true,true');

      run([
        dbUrl,
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `
        INSERT INTO public.booking_legs (id, status, assigned_driver_id, deleted_at) VALUES
          ('11111111-1111-1111-1111-111111111111', 'PENDING', NULL, NULL),
          ('22222222-2222-2222-2222-222222222222', 'ASSIGNED', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL);
        DO $$
        BEGIN
          IF public.job_leg_is_offerable('11111111-1111-1111-1111-111111111111') IS NOT TRUE THEN
            RAISE EXCEPTION 'PENDING unassigned should be offerable';
          END IF;
          IF public.job_leg_is_offerable('22222222-2222-2222-2222-222222222222') IS NOT FALSE THEN
            RAISE EXCEPTION 'ASSIGNED should not be offerable';
          END IF;
        END $$;
        `
      ]);
    } finally {
      try {
        run([adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
      } catch {
        try {
          run([adminUrl, '-c', `DROP DATABASE IF EXISTS ${dbName}`]);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  });
});

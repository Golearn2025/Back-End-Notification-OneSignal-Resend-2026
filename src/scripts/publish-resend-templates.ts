/**
 * Creează sau actualizează template-urile Resend din `docs/resend-templates/*.html`
 * și le publică (aliasuri folosite de `ResendProvider`).
 *
 * Cheie API: `RESEND_TEMPLATE_AUDIT_API_KEY`, sau fallback `RESEND_API_KEY` dacă are scope Templates.
 * Opțional: `RESEND_FROM_EMAIL` pentru default `from` pe template.
 *
 * Rulare: `npm run publish-resend-templates`
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: join(ROOT, '.env') });

const RESEND_API = 'https://api.resend.com';

const RESERVED_VAR_KEYS = new Set([
  'FIRST_NAME',
  'LAST_NAME',
  'EMAIL',
  'UNSUBSCRIBE_URL',
  'RESEND_UNSUBSCRIBE_URL',
  'contact',
  'this'
]);

type TemplateDef = {
  readonly alias: string;
  readonly filename: string;
  readonly displayName: string;
  readonly defaultSubject: string;
};

const TEMPLATES: readonly TemplateDef[] = [
  {
    alias: 'customer_account_created_v1',
    filename: 'customer_account_created_v1.html',
    displayName: 'Vantage Lane — customer account created v1',
    defaultSubject: 'Welcome to Vantage Lane'
  },
  {
    alias: 'payment_success_customer_v1',
    filename: 'payment_success_customer_v1.html',
    displayName: 'Vantage Lane — payment success customer v1',
    defaultSubject: 'Payment received for your Vantage Lane booking'
  },
  {
    alias: 'jobs_mailbox_booking_confirmed_v1',
    filename: 'jobs_mailbox_booking_confirmed_v1.html',
    displayName: 'Vantage Lane — jobs mailbox booking confirmed v1',
    defaultSubject: 'New booking alert'
  },
  {
    alias: 'driver_job_accepted_v1',
    filename: 'driver_job_accepted_v1.html',
    displayName: 'Vantage Lane — driver job accepted v1',
    defaultSubject: 'Job confirmed — Vantage Lane'
  }
] as const;

function extractVariableKeys(html: string): string[] {
  const re = /\{\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\}/g;
  const found = new Set<string>();
  for (const m of html.matchAll(re)) {
    const key = m[1] ?? '';
    if (key && !RESERVED_VAR_KEYS.has(key.toUpperCase())) {
      found.add(key);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

function buildVariables(keys: readonly string[]): Array<{ key: string; type: 'string'; fallback_value: string }> {
  return keys.map((key) => ({
    key,
    type: 'string' as const,
    fallback_value: '—'
  }));
}

async function resendJson<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; json: T }> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${RESEND_API}${path}`, init);
  const json = (await res.json()) as T;
  return { ok: res.ok, status: res.status, json };
}

type ListTemplatesResponse = {
  object?: string;
  data?: Array<{ id: string; name?: string; alias?: string | null }>;
  has_more?: boolean;
};

async function listAllTemplates(apiKey: string): Promise<Array<{ id: string; alias: string | null | undefined }>> {
  const out: Array<{ id: string; alias: string | null | undefined }> = [];
  let after: string | undefined;

  for (let page = 0; page < 50; page += 1) {
    const q = new URLSearchParams({ limit: '100' });
    if (after) {
      q.set('after', after);
    }
    const { ok, status, json } = await resendJson<ListTemplatesResponse>(apiKey, 'GET', `/templates?${q.toString()}`);
    if (!ok) {
      throw new Error(`List templates failed: HTTP ${status} ${JSON.stringify(json)}`);
    }
    const chunk = json.data ?? [];
    out.push(...chunk.map((row) => ({ id: row.id, alias: row.alias })));
    if (!json.has_more || chunk.length === 0) {
      break;
    }
    after = chunk[chunk.length - 1]?.id;
    if (!after) {
      break;
    }
  }

  return out;
}

type CreateTemplateResponse = { id?: string; object?: string; message?: string };

function stripEnvQuotes(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const t = value.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

async function main(): Promise<void> {
  const apiKey =
    process.env.RESEND_TEMPLATE_AUDIT_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim();
  if (!apiKey || !/^re_[A-Za-z0-9_-]+$/.test(apiKey)) {
    console.error(
      'Lipsește sau e invalidă cheia Resend. Setează RESEND_TEMPLATE_AUDIT_API_KEY (recomandat) sau RESEND_API_KEY.'
    );
    process.exit(1);
  }

  const fromDefault = stripEnvQuotes(process.env.RESEND_FROM_EMAIL);
  const templatesDir = join(ROOT, 'docs/resend-templates');

  console.log('Încarc lista de template-uri existente…');
  const existing = await listAllTemplates(apiKey);
  const byAlias = new Map(existing.filter((r) => r.alias).map((r) => [r.alias as string, r.id]));

  for (const def of TEMPLATES) {
    const htmlPath = join(templatesDir, def.filename);
    const html = readFileSync(htmlPath, 'utf8');
    const keys = extractVariableKeys(html);
    const variables = buildVariables(keys);

    const payload: Record<string, unknown> = {
      name: def.displayName,
      alias: def.alias,
      html,
      subject: def.defaultSubject,
      variables
    };
    if (fromDefault) {
      payload.from = fromDefault;
    }

    const existingId = byAlias.get(def.alias);

    let templateId: string;
    if (existingId) {
      console.log(`Actualizez template „${def.alias}” (${existingId})…`);
      const { ok, status, json } = await resendJson<CreateTemplateResponse>(
        apiKey,
        'PATCH',
        `/templates/${encodeURIComponent(existingId)}`,
        payload
      );
      if (!ok) {
        throw new Error(`Update failed for ${def.alias}: HTTP ${status} ${JSON.stringify(json)}`);
      }
      templateId = json.id ?? existingId;
    } else {
      console.log(`Creez template „${def.alias}”…`);
      const { ok, status, json } = await resendJson<CreateTemplateResponse>(
        apiKey,
        'POST',
        '/templates',
        payload
      );
      if (!ok) {
        throw new Error(`Create failed for ${def.alias}: HTTP ${status} ${JSON.stringify(json)}`);
      }
      if (!json.id) {
        throw new Error(`Create response missing id for ${def.alias}: ${JSON.stringify(json)}`);
      }
      templateId = json.id;
    }

    console.log(`Public template „${def.alias}” (${templateId})…`);
    const pub = await resendJson<CreateTemplateResponse>(
      apiKey,
      'POST',
      `/templates/${encodeURIComponent(templateId)}/publish`,
      {}
    );
    if (!pub.ok) {
      throw new Error(`Publish failed for ${def.alias}: HTTP ${pub.status} ${JSON.stringify(pub.json)}`);
    }

    console.log(`OK: ${def.alias} (${templateId}), variabile: ${keys.length}`);
  }

  console.log('Gata. Verifică în Resend → Templates că statusul e „published”.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

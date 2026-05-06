import { z } from 'zod';

/** Resend API keys: accept any non-empty string after trim. Empty string → treated as unset. */
function optionalResendSecretKey(envKey: string) {
  return z.preprocess(
    (val) => {
      if (val === undefined || val === null) {
        return undefined;
      }
      const s = String(val).trim();
      return s.length === 0 ? undefined : s;
    },
    z.union([
      z.undefined(),
      z.string().min(1, `${envKey} must be a non-empty string`)
    ])
  );
}

const optionalResendFromEmail = z.preprocess(
  (val) => {
    if (val === undefined || val === null) {
      return undefined;
    }
    const s = String(val).trim();
    return s.length === 0 ? undefined : s;
  },
  z.union([z.undefined(), z.string().min(1)])
);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive(),
  INTERNAL_API_SECRET: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_REALTIME_KEY: z.string().min(1).optional(),
  SUPABASE_REALTIME_DISABLE_PROXY: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  WORKER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  WORKER_MODE: z.enum(['once', 'loop']).default('once'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  SUPABASE_REALTIME_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  SUPABASE_REALTIME_CHANNEL: z.string().min(1).default('notification-events'),

  // Optional in Phase 1; real provider sending is not implemented yet.
  ONESIGNAL_APP_ID: z.string().min(1).optional(),
  ONESIGNAL_REST_API_KEY: z.string().min(1).optional(),
  /** Sending transactional email (`POST /emails`). */
  RESEND_API_KEY: optionalResendSecretKey('RESEND_API_KEY'),
  // Resend supports "Name <email@domain.com>" display form; not a plain RFC email string.
  RESEND_FROM_EMAIL: optionalResendFromEmail,
  /**
   * Optional second key (e.g. restricted “Templates” scope) for `POST /templates` etc.
   * Independent of `RESEND_API_KEY` / `RESEND_FROM_EMAIL`.
   */
  RESEND_TEMPLATE_AUDIT_API_KEY: optionalResendSecretKey('RESEND_TEMPLATE_AUDIT_API_KEY'),
  PUBLIC_WEBSITE_URL: z.string().url().optional()
});

const envSchemaWithResendPairing = envSchema.superRefine((data, ctx) => {
  const hasKey = Boolean(data.RESEND_API_KEY);
  const hasFrom = Boolean(data.RESEND_FROM_EMAIL);
  if (hasKey && !hasFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'RESEND_FROM_EMAIL is required when RESEND_API_KEY is set',
      path: ['RESEND_FROM_EMAIL']
    });
  }
  if (hasFrom && !hasKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'RESEND_API_KEY is required when RESEND_FROM_EMAIL is set',
      path: ['RESEND_API_KEY']
    });
  }
});

export function parseEnv(rawEnv: Record<string, string | undefined>) {
  const parsed = envSchemaWithResendPairing.safeParse(rawEnv);

  if (!parsed.success) {
    const formatted = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment variables: ${JSON.stringify(formatted)}`);
  }

  return parsed.data;
}

export type Env = z.infer<typeof envSchemaWithResendPairing>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }

  return cachedEnv;
}

/** Clears memoized env (Vitest / scripts that mutate process.env between runs). */
export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}

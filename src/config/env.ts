import { z } from 'zod';

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
    .transform((value) => value !== 'false'),
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
  RESEND_API_KEY: z.string().min(1).optional(),
  // Resend supports "Name <email@domain.com>" display form; not a plain RFC email string.
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  PUBLIC_WEBSITE_URL: z.string().url().optional()
});

export function parseEnv(rawEnv: Record<string, string | undefined>) {
  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    const formatted = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment variables: ${JSON.stringify(formatted)}`);
  }

  return parsed.data;
}

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }

  return cachedEnv;
}

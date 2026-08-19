import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Which dotenv file to load. Defaults to the long-standing one, which sits a
// level above the repo root (`__dirname` is backend/src under tsx and
// backend/dist once built, so three levels up lands outside the checkout).
// `ENV_FILE` selects a different one, so a second environment — the v2 Upstash
// DB and Render service — can be run locally without editing the file holding
// live v1 credentials.
//
// The selected file REPLACES the default rather than layering over it. A
// variable missing from it fails startup below instead of quietly inheriting
// the other environment's value; that is what stops a v2 run from reading and
// writing v1's production Redis by omission.
const DEFAULT_ENV_PATH = path.join(__dirname, '../../../.env');
const envFileOverride = process.env['ENV_FILE'];
// Relative paths resolve against the working directory, since this is typed at
// a shell prompt (usually from backend/), not against this file's location.
const envPath = envFileOverride
  ? path.resolve(process.cwd(), envFileOverride)
  : DEFAULT_ENV_PATH;

if (envFileOverride) {
  if (!fs.existsSync(envPath)) {
    console.error(`❌ ENV_FILE is set to "${envFileOverride}" but no file exists at ${envPath}`);
    process.exit(1);
  }
  // Announce it — running against the wrong environment is the expensive
  // mistake here, and silence is what makes it easy.
  console.log(`⚙️  Loading environment from ${envPath}`);
}

// Note: dotenv does not overwrite variables already present in process.env, so
// an inline `FOO=bar npm run dev` still wins over whichever file is loaded.
//
// A missing file here is not an error: on a hosted deploy (Render) there is no
// env file at all and every variable comes from the platform environment. The
// absence is only worth reporting if validation then fails, which is what the
// error branch below does — otherwise a machine with no env file produces a
// list of "Required" errors that never mentions the file was never found.
const dotenvResult = dotenv.config({ path: envPath });
const envFileWasLoaded = !dotenvResult.error;

const envSchema = z.object({
  // Admin
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required'),

  // Kapso
  KAPSO_API_KEY: z.string().min(1, 'KAPSO_API_KEY is required'),
  KAPSO_PHONE_NUMBER_ID: z.string().min(1, 'KAPSO_PHONE_NUMBER_ID is required'),
  WHITELISTED_NUMBERS: z.string().min(1, 'WHITELISTED_NUMBERS is required'),

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: z.string().url('UPSTASH_REDIS_REST_URL must be a valid URL'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

  // QStash
  QSTASH_TOKEN: z.string().min(1, 'QSTASH_TOKEN is required'),
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1, 'QSTASH_CURRENT_SIGNING_KEY is required'),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1, 'QSTASH_NEXT_SIGNING_KEY is required'),
  QSTASH_URL: z.string().url().optional(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_REDIRECT_URI: z.string().url('GOOGLE_REDIRECT_URI must be a valid URL'),

  // Security
  TOKEN_ENCRYPTION_KEY: z.string().length(32, 'TOKEN_ENCRYPTION_KEY must be exactly 32 characters'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  WEBHOOK_SECRET: z.string().min(1).optional(),

  // App
  BASE_URL: z.string().url('BASE_URL must be a valid URL'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  console.error(
    envFileWasLoaded
      ? `\nLoaded from ${envPath} — the variables above are missing or invalid in that file.`
      : `\nNo env file was found at ${envPath}, so every variable had to come from the ` +
        `process environment. On a hosted deploy that is normal; locally, point ENV_FILE at a file ` +
        `(e.g. ENV_FILE=../v2.env npm run dev).`
  );
  process.exit(1);
}

export const env = parsed.data;

/** Hostname only — the token is the secret, and it must never reach a log. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
}

// Say out loud which environment this process is pointed at. v1 and v2 share
// Kapso, QStash, and Google credentials, so the Redis host and BASE_URL are
// most of what distinguishes them — and pointing a run at the wrong database is
// invisible in behaviour: the two write different key namespaces, so a
// misdirected run silently accumulates a parallel dataset instead of failing.
console.log(
  `🔌 redis=${hostOf(env.UPSTASH_REDIS_REST_URL)} base=${hostOf(env.BASE_URL)} env=${env.NODE_ENV}`
);

export const whitelistedNumbers = env.WHITELISTED_NUMBERS.split(',').map((n) => n.trim());

import { z } from 'zod';

const digest = /^[0-9a-f]{64}$/;

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((u) => /^postgres(ql)?:\/\//.test(u), 'must be a postgres:// URL')
      .refine(
        (u) => /[?&]connection_limit=\d+/.test(u),
        'must include connection_limit (e.g. ?connection_limit=25)',
      )
      .refine((u) => /[?&]pool_timeout=\d+/.test(u), 'must include pool_timeout (e.g. &pool_timeout=10)'),
    PRISMA_TX_MAX_WAIT_MS: z.coerce.number().int().positive().default(10000),
    PRISMA_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    DISCORD_CLIENT_ID: z.string().min(1),
    DISCORD_CLIENT_SECRET: z.string().min(1),
    DISCORD_REDIRECT_URI: z.string().url(),
    DISCORD_API_BASE: z.string().url().default('https://discord.com'),
    FRONTEND_URL: z.string().url(),
    BOT_API_KEYS: z
      .string()
      .min(1)
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean),
      )
      .refine((a) => a.length >= 1 && a.length <= 2, 'must hold one or two digests')
      .refine((a) => a.every((d) => digest.test(d)), 'each entry must be a sha256 hex digest (64 hex chars)'),
    /** Claim/release rate limit per member per second (design 9: 5). Tests raise it to exercise the cap. */
    CLAIM_RATE_MAX: z.coerce.number().int().min(1).max(100000).default(5),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    NOTIFICATIONS_PROVIDER: z.enum(['bot', 'fake', 'off']).default('off'),
    DISCORD_BOT_NOTIFY_URL: z.string().url().optional(),
    DISCORD_BOT_NOTIFY_SECRET: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.NOTIFICATIONS_PROVIDER === 'bot') {
      for (const k of ['DISCORD_BOT_NOTIFY_URL', 'DISCORD_BOT_NOTIFY_SECRET'] as const) {
        if (!v[k])
          ctx.addIssue({ code: 'custom', path: [k], message: 'required when NOTIFICATIONS_PROVIDER=bot' });
      }
    }
  });

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}

/** Empty strings (as in a copied .env.example) count as unset. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') cleaned[k] = v;
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`));
  }
  return parsed.data;
}

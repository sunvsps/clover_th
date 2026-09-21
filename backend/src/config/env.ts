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
    /** Default request budget per minute: per member when signed in, per IP otherwise (design 9). */
    RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().min(1).max(1_000_000).default(600),
    RATE_LIMIT_ANON_PER_MIN: z.coerce.number().int().min(1).max(1_000_000).default(120),
    /** Wrong X-Bot-Key attempts per minute per IP before the bot routes answer 429 (brute-force guard). */
    BOT_KEY_FAILS_PER_MIN: z.coerce.number().int().min(1).max(1_000_000).default(20),
    /**
     * Who may read the OpenAPI document at /docs/json: auto = public outside production, off in production;
     * public | admin (signed-in admin only) | off.
     */
    DOCS_ACCESS: z.enum(['auto', 'public', 'admin', 'off']).default('auto'),
    /**
     * Number of trusted reverse proxies in front of the API (0 = none, the default: X-Forwarded-For is ignored).
     * With N the client IP is the N-th address from the RIGHT of the chain, so a client cannot forge it by sending
     * its own X-Forwarded-For. Use TRUST_PROXY_CIDRS instead when the proxies have fixed addresses.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Comma-separated proxy addresses or CIDRs to trust (overrides TRUST_PROXY_HOPS when set). */
    TRUST_PROXY_CIDRS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .refine(
        (a) => a.every((c) => /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(c)),
        'each entry must be an IP or CIDR',
      ),
    /** REMOVED: the old boolean trusted the whole X-Forwarded-For chain. Startup fails if it is set to true. */
    TRUST_PROXY: z.string().optional(),
    /** Cheap per-IP request budget applied BEFORE the session lookup (protects the database from anonymous floods). */
    PREAUTH_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(10_000_000).default(6000),
    /** Sliding session lifetime: refreshed at most hourly while the member is active. */
    SESSION_SLIDING_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /** Hard cap from login: a session never lives longer, however often it is used. */
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(730).default(90),
    NOTIFICATIONS_PROVIDER: z.enum(['bot', 'fake', 'off']).default('off'),
    DISCORD_BOT_NOTIFY_URL: z.string().url().optional(),
    DISCORD_BOT_NOTIFY_SECRET: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.TRUST_PROXY !== undefined && /^(true|1|yes)$/i.test(v.TRUST_PROXY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message:
          'TRUST_PROXY=true trusted the whole X-Forwarded-For chain and is no longer supported: set TRUST_PROXY_HOPS (number of trusted proxies, usually 1) or TRUST_PROXY_CIDRS',
      });
    }
    if (v.SESSION_ABSOLUTE_DAYS < v.SESSION_SLIDING_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_ABSOLUTE_DAYS'],
        message: 'must be >= SESSION_SLIDING_DAYS',
      });
    }
    if (v.NODE_ENV === 'production') {
      const secret = v.SESSION_SECRET;
      if (
        secret.length < 43 ||
        new Set(secret).size < 16 ||
        /change[-_ ]?me|placeholder|example|secret-?key/i.test(secret)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['SESSION_SECRET'],
          message:
            'in production it must be a real random secret (>= 43 characters, not a placeholder). Generate one: openssl rand -base64 48',
        });
      }
    }
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

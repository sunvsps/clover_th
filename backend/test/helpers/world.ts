import type { RouteOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { CSRF, createTestApp } from './app.js';
import { loginAs } from './auth.js';
import { createTestDb, truncateAll, type TestDb } from './db.js';
import { startMockDiscord, type MockDiscord } from './mockDiscord.js';

export type World = {
  db: TestDb;
  mock: MockDiscord;
  app: Awaited<ReturnType<typeof createTestApp>>;
  member: (
    ign?: string,
    extra?: Record<string, unknown>,
  ) => Promise<{ id: string; discordId: string; ign: string }>;
  /** Creates a member and signs them in through the real OAuth flow. */
  signIn: (opts?: {
    admin?: boolean;
    ign?: string;
  }) => Promise<{ id: string; discordId: string; cookie: string; h: Record<string, string> }>;
};

let counter = 5_000_000;

/** Registers beforeAll/afterAll/beforeEach hooks: one DB per file, truncated and re-seeded before each test. */
export function useWorld(
  opts: {
    env?: Record<string, string>;
    setup?: (app: World['app']) => void;
    onRoute?: (r: RouteOptions) => void;
  } = {},
): World {
  const w = {} as World;
  beforeAll(async () => {
    w.db = await createTestDb();
    w.mock = await startMockDiscord();
    w.app = await createTestApp(w.db, {
      mock: w.mock,
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.onRoute ? { onRoute: opts.onRoute } : {}),
    });
    opts.setup?.(w.app);
    await w.app.ready();
  });
  afterAll(async () => {
    await w.app.close();
    await w.mock.close();
    await w.db.drop();
  });
  beforeEach(async () => {
    await truncateAll(w.db.prisma);
    await seed(w.db.prisma);
  });
  w.member = async (ign, extra = {}) => {
    const n = ++counter;
    const m = await w.db.prisma.member.create({
      data: { discordId: String(n), ign: ign ?? `member-${n}`, nickname: 'nick', jobId: 2, ...extra },
    });
    return { id: m.id, discordId: m.discordId, ign: m.ign };
  };
  w.signIn = async (o = {}) => {
    const m = await w.member(o.ign, o.admin ? { isAdmin: true } : {});
    const { cookie } = await loginAs(w.app, w.mock, m.discordId);
    return { ...m, cookie: cookie!, h: { cookie: cookie!, ...CSRF } };
  };
  return w;
}

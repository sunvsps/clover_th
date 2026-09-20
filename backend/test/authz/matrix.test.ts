import type { RouteOptions } from 'fastify';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { createTestApp } from '../helpers/app.js';
import { loginAs } from '../helpers/auth.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { startMockDiscord, type MockDiscord } from '../helpers/mockDiscord.js';
import { assertComplete, runMatrix, type MatrixCtx } from './matrix.js';
import { routes } from './routes.js';

let db: TestDb;
let mock: MockDiscord;
let ctx: MatrixCtx;
const registered: { method: string; url: string }[] = [];

beforeAll(async () => {
  db = await createTestDb();
  mock = await startMockDiscord();
  await seed(db.prisma);
  const onRoute = (r: RouteOptions) => {
    for (const m of [r.method].flat())
      if (m !== 'HEAD' && m !== 'OPTIONS') registered.push({ method: m, url: r.url });
  };
  const app = await createTestApp(db, { mock, onRoute });
  await app.ready();
  await db.prisma.member.create({
    data: { discordId: '60001', ign: 'MatrixMember', nickname: 'm', jobId: 1 },
  });
  await db.prisma.member.create({
    data: { discordId: '60002', ign: 'MatrixAdmin', nickname: 'a', jobId: 1, isAdmin: true },
  });
  ctx = {
    app,
    memberCookie: (await loginAs(app, mock, '60001')).cookie!,
    adminCookie: (await loginAs(app, mock, '60002')).cookie!,
    freshMember: async () => (await loginAs(app, mock, '60001')).cookie!,
    freshAdmin: async () => (await loginAs(app, mock, '60002')).cookie!,
  };
});
afterAll(async () => {
  await ctx.app.close();
  await mock.close();
  await db.drop();
});

describe('authz matrix completeness', () => {
  it('every registered route has a matrix entry and vice versa', () => {
    assertComplete(registered, routes);
  });
});

runMatrix(routes, () => ctx);

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../prisma/seed.js';
import { DevLoginRefused, assertDevLoginAllowed, createDevSession } from '../../src/lib/devLogin.js';
import { CSRF, createTestApp } from '../helpers/app.js';
import { createTestDb, type TestDb } from '../helpers/db.js';

const run = promisify(execFile);
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await seed(db.prisma);
  await db.prisma.member.create({
    data: { discordId: '5550001', ign: 'DevAdmin', nickname: 'd', jobId: 1, isAdmin: true },
  });
  await db.prisma.member.create({
    data: { discordId: '5550002', ign: 'DevGone', nickname: 'd', jobId: 1, isActive: false },
  });
});
afterAll(() => db.drop());

const LOCAL = 'postgresql://u:p@localhost:5432/x?connection_limit=5&pool_timeout=5';

describe('dev login guard', () => {
  it('refuses in production, without a database, and for a non-local database unless explicitly allowed', () => {
    expect(() => assertDevLoginAllowed({ NODE_ENV: 'production', DATABASE_URL: LOCAL })).toThrow(
      /production/,
    );
    expect(() => assertDevLoginAllowed({ DATABASE_URL: '' })).toThrow(DevLoginRefused);
    expect(() => assertDevLoginAllowed({ DATABASE_URL: 'not a url' })).toThrow(DevLoginRefused);
    const remote = 'postgresql://u:p@db.prod.example.com:5432/x';
    expect(() => assertDevLoginAllowed({ NODE_ENV: 'development', DATABASE_URL: remote })).toThrow(
      /not a local database/,
    );
    expect(() =>
      assertDevLoginAllowed({ DATABASE_URL: remote, DEV_LOGIN_ALLOW_REMOTE_DB: '1' }),
    ).not.toThrow();
    for (const env of [undefined, 'development', 'test'])
      expect(() => assertDevLoginAllowed({ NODE_ENV: env, DATABASE_URL: LOCAL })).not.toThrow();
    expect(() =>
      assertDevLoginAllowed({ NODE_ENV: 'production', DATABASE_URL: LOCAL, DEV_LOGIN_ALLOW_REMOTE_DB: '1' }),
    ).toThrow();
  });
});

describe('dev login session', () => {
  it('creates a normal session: the cookie works on the API, writes need the CSRF header, only the hash is stored, no token in the audit log', async () => {
    const { token, member } = await createDevSession(db.prisma, '5550001', 2);
    expect(member).toMatchObject({ ign: 'DevAdmin', isAdmin: true });
    const app = await createTestApp(db);
    await app.ready();
    const cookie = `session=${token}`;
    const me = await app.inject({ url: '/api/v1/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ discordId: '5550001', isAdmin: true });
    const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
    expect(noCsrf.json().error.code).toBe('CSRF_REJECTED');
    const rows = await db.prisma.session.findMany({ where: { memberId: member.id } });
    expect(rows.every((r) => r.id !== token && /^[0-9a-f]{64}$/.test(r.id))).toBe(true);
    const logs = JSON.stringify(await db.prisma.auditLog.findMany());
    expect(logs).not.toContain(token);
    expect(logs).toContain('auth.dev_login');
    const s = rows[rows.length - 1]!;
    expect(s.expiresAt.getTime() - Date.now()).toBeLessThan(2.1 * 3600e3);
    expect(s.expiresAt.getTime() - Date.now()).toBeGreaterThan(1.5 * 3600e3);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, ...CSRF } }))
        .statusCode,
    ).toBe(204);
    await app.close();
  });

  it('refuses unknown, deactivated members and silly lifetimes', async () => {
    await expect(createDevSession(db.prisma, '9999999')).rejects.toThrow(/No member/);
    await expect(createDevSession(db.prisma, '5550002')).rejects.toThrow(/deactivated/);
    await expect(createDevSession(db.prisma, '5550001', 0)).rejects.toThrow(DevLoginRefused);
    await expect(createDevSession(db.prisma, '5550001', 48)).rejects.toThrow(DevLoginRefused);
  });
});

describe('scripts/dev-login.ts', () => {
  const tsx = 'node_modules/.bin/tsx';
  const base = { PATH: process.env.PATH!, HOME: process.env.HOME ?? '' };

  it('refuses to run when NODE_ENV=production: exit 1, no session, no output of a cookie', async () => {
    const before = await db.prisma.session.count();
    const res = await run(tsx, ['scripts/dev-login.ts', '5550001'], {
      env: { ...base, NODE_ENV: 'production', DATABASE_URL: db.url },
    }).catch((e) => e);
    expect(res.code).toBe(1);
    expect(String(res.stderr)).toContain('refused');
    expect(String(res.stdout)).not.toContain('Cookie');
    expect(await db.prisma.session.count()).toBe(before);
  });

  it('prints the cookie and the CSRF header for a local database, and the cookie logs in', async () => {
    const { stdout } = await run(tsx, ['scripts/dev-login.ts', '5550001', '--hours', '1'], {
      env: { ...base, NODE_ENV: 'development', DATABASE_URL: db.url, FRONTEND_URL: 'http://localhost:5173' },
    });
    expect(stdout).toContain('Signed in as DevAdmin (admin)');
    expect(stdout).toContain('X-Requested-With: dev-login');
    expect(stdout).toContain('Origin: http://localhost:5173');
    const token = /Cookie: session=(\S+)/.exec(stdout)![1]!;
    const app = await createTestApp(db);
    await app.ready();
    expect(
      (await app.inject({ url: '/api/v1/me', headers: { cookie: `session=${token}` } })).statusCode,
    ).toBe(200);
    await app.close();
    expect(JSON.stringify(await db.prisma.auditLog.findMany())).not.toContain(token);
  });

  it('refuses a bad discord id and a remote database', async () => {
    const bad = await run(tsx, ['scripts/dev-login.ts', 'abc'], {
      env: { ...base, DATABASE_URL: db.url },
    }).catch((e) => e);
    expect(bad.code).toBe(1);
    const remote = await run(tsx, ['scripts/dev-login.ts', '5550001'], {
      env: { ...base, DATABASE_URL: 'postgresql://u:p@db.prod.example.com:5432/x' },
    }).catch((e) => e);
    expect(remote.code).toBe(1);
    expect(String(remote.stderr)).toContain('not a local database');
  });
});

describe('no HTTP login route exists unless LOCAL_DEMO_ENABLED=true', () => {
  it('with the flag off (the default) nothing creates a session without Discord', async () => {
    const app = await createTestApp(db);
    await app.ready();
    for (const url of [
      '/api/v1/auth/dev-login',
      '/api/v1/dev-login',
      '/api/v1/auth/session',
      '/dev-login',
      '/api/v1/demo/login',
      '/api/v1/demo/members',
    ]) {
      for (const method of ['GET', 'POST', 'PUT'] as const)
        expect((await app.inject({ method, url })).statusCode).toBe(404);
    }
    await app.close();
  });
});

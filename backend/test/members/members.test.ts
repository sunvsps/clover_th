import { describe, expect, it } from 'vitest';
import { BOT_KEY } from '../helpers/app.js';
import { useWorld } from '../helpers/world.js';

const w = useWorld();
const get = (url: string, h: Record<string, string>) => w.app.inject({ url, headers: h });
const send = (method: 'PATCH' | 'POST' | 'PUT', url: string, h: Record<string, string>, payload?: object) =>
  w.app.inject({ method, url, headers: h, ...(payload ? { payload } : {}) });

describe('WP4 members', () => {
  it('roster: any member sees active members without discordId or admin flag', async () => {
    const me = await w.signIn();
    await w.member('Zed');
    await w.member('Gone', { isActive: false });
    const r = await get('/api/v1/members', me.h);
    expect(r.statusCode).toBe(200);
    const list = r.json();
    expect(list.map((m: { ign: string }) => m.ign)).toContain('Zed');
    expect(list.map((m: { ign: string }) => m.ign)).not.toContain('Gone');
    expect(Object.keys(list[0]).sort()).toEqual(['id', 'ign', 'jobId', 'nickname']);
  });

  it('admin list adds fields; incomplete and includeInactive filters work', async () => {
    const admin = await w.signIn({ admin: true });
    await w.member('NoNick', { nickname: null });
    await w.member('Manual', { source: 'MANUAL' });
    await w.member('Complete');
    await w.member('OldNoNick', { nickname: null, isActive: false });
    const all = (await get('/api/v1/admin/members', admin.h)).json();
    expect(all[0]).toHaveProperty('discordId');
    expect(all.some((m: { ign: string }) => m.ign === 'OldNoNick')).toBe(false);
    const inc = (await get('/api/v1/admin/members?incomplete=1', admin.h)).json();
    expect(inc.map((m: { ign: string }) => m.ign).sort()).toEqual(['Manual', 'NoNick']);
    const incAll = (await get('/api/v1/admin/members?incomplete=1&includeInactive=1', admin.h)).json();
    expect(incAll.map((m: { ign: string }) => m.ign)).toContain('OldNoNick');
  });

  it('non-admins cannot use admin routes', async () => {
    const me = await w.signIn();
    const other = await w.member('Other');
    expect((await get('/api/v1/admin/members', me.h)).json().error.code).toBe('ADMIN_REQUIRED');
    expect((await send('PATCH', `/api/v1/admin/members/${other.id}`, me.h, { ign: 'X' })).statusCode).toBe(
      403,
    );
    expect((await get('/api/v1/admin/audit-log', me.h)).json().error.code).toBe('ADMIN_REQUIRED');
  });

  it('admin filling in a missing nickname removes the member from the incomplete list, with an audit row (before/after)', async () => {
    const admin = await w.signIn({ admin: true });
    const m = await w.member('Filler', { nickname: null });
    expect(
      (await get('/api/v1/admin/members?incomplete=1', admin.h)).json().map((x: { id: string }) => x.id),
    ).toContain(m.id);
    const r = await send('PATCH', `/api/v1/admin/members/${m.id}`, admin.h, { nickname: 'Fill' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ nickname: 'Fill', isIncomplete: false });
    expect(
      (await get('/api/v1/admin/members?incomplete=1', admin.h)).json().map((x: { id: string }) => x.id),
    ).not.toContain(m.id);
    const log = await w.db.prisma.auditLog.findFirstOrThrow({
      where: { action: 'member.update', entityId: m.id },
    });
    expect(log).toMatchObject({ actorType: 'MEMBER', actorId: admin.id });
    expect(log.meta).toMatchObject({ via: 'admin', changes: { nickname: { from: null, to: 'Fill' } } });
    expect(log.at.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('editing an IGN to an existing active IGN gives DUPLICATE_IGN and changes nothing', async () => {
    const admin = await w.signIn({ admin: true });
    await w.member('Taken');
    const m = await w.member('Mine');
    const r = await send('PATCH', `/api/v1/admin/members/${m.id}`, admin.h, { ign: 'tAKEN' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('DUPLICATE_IGN');
    expect((await w.db.prisma.member.findUniqueOrThrow({ where: { id: m.id } })).ign).toBe('Mine');
  });

  it('PATCH validates: empty body, unknown field (isAdmin), bad job, unknown member', async () => {
    const admin = await w.signIn({ admin: true });
    const m = await w.member('Val');
    expect((await send('PATCH', `/api/v1/admin/members/${m.id}`, admin.h, {})).statusCode).toBe(422);
    expect(
      (await send('PATCH', `/api/v1/admin/members/${m.id}`, admin.h, { isAdmin: true })).statusCode,
    ).toBe(422);
    expect(
      (await send('PATCH', `/api/v1/admin/members/${m.id}`, admin.h, { jobId: 999 })).json().error.code,
    ).toBe('INVALID_JOB');
    const nf = await send('PATCH', '/api/v1/admin/members/00000000-0000-4000-8000-000000000000', admin.h, {
      ign: 'x',
    });
    expect(nf.json().error.code).toBe('MEMBER_NOT_FOUND');
  });

  it('every admin write produces an audit row with actor and server time', async () => {
    const admin = await w.signIn({ admin: true });
    const m = await w.member('Audited');
    await send('PATCH', `/api/v1/admin/members/${m.id}`, admin.h, { jobId: 3 });
    await send('POST', `/api/v1/admin/members/${m.id}/deactivate`, admin.h);
    await send('POST', `/api/v1/admin/members/${m.id}/reactivate`, admin.h);
    await send('PUT', '/api/v1/admin/jobs', admin.h, { jobs: (await get('/api/v1/jobs', admin.h)).json() });
    const actions = (await w.db.prisma.auditLog.findMany({ where: { actorId: admin.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['member.update', 'member.deactivate', 'member.reactivate']),
    );
    const rows = await w.db.prisma.auditLog.findMany({ where: { entityId: m.id } });
    expect(rows.every((a) => a.at instanceof Date && a.actorType === 'MEMBER')).toBe(true);
  });

  it('deactivate then reactivate: reactivation with a now-used IGN gives DUPLICATE_IGN', async () => {
    const admin = await w.signIn({ admin: true });
    const old = await w.member('Reused');
    await send('POST', `/api/v1/admin/members/${old.id}/deactivate`, admin.h);
    await w.member('reused');
    const r = await send('POST', `/api/v1/admin/members/${old.id}/reactivate`, admin.h);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('DUPLICATE_IGN');
    expect((await w.db.prisma.member.findUniqueOrThrow({ where: { id: old.id } })).isActive).toBe(false);
  });

  it('reactivating a free IGN works and is idempotent (second call writes no audit)', async () => {
    const admin = await w.signIn({ admin: true });
    const m = await w.member('Back', { isActive: false });
    expect((await send('POST', `/api/v1/admin/members/${m.id}/reactivate`, admin.h)).json().isActive).toBe(
      true,
    );
    const n = await w.db.prisma.auditLog.count({ where: { action: 'member.reactivate' } });
    expect((await send('POST', `/api/v1/admin/members/${m.id}/reactivate`, admin.h)).statusCode).toBe(200);
    expect(await w.db.prisma.auditLog.count({ where: { action: 'member.reactivate' } })).toBe(n);
  });
});

describe('WP4 bot audit before/after', () => {
  it('a changed IGN / nickname / job records from and to; an unchanged repeat records nothing', async () => {
    const k = { 'x-bot-key': BOT_KEY };
    const put = (payload: object) =>
      w.app.inject({ method: 'PUT', url: '/api/v1/bot/members/31337', headers: k, payload });
    await put({ ign: 'Old', job: 'Knight', nickname: 'ON' });
    await put({ ign: 'New', job: 'Wizard', nickname: 'NN' });
    const n = await w.db.prisma.auditLog.count();
    await put({ ign: 'New', job: 'Wizard', nickname: 'NN' });
    expect(await w.db.prisma.auditLog.count()).toBe(n);
    const upd = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'member.update' } });
    expect(upd.actorType).toBe('BOT');
    expect(upd.meta).toMatchObject({
      via: 'bot',
      changes: {
        ign: { from: 'Old', to: 'New' },
        nickname: { from: 'ON', to: 'NN' },
        jobId: { from: 2, to: 3 },
      },
    });
    const created = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'member.create' } });
    expect(created.meta).toMatchObject({ created: { ign: 'Old', jobId: 2 } });
  });
});

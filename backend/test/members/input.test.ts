import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { isCleanText, nameField, safeString } from '../../src/lib/text.js';
import { BOT_KEY } from '../helpers/app.js';
import { useWorld } from '../helpers/world.js';

const w = useWorld({
  setup: (app) => {
    app.get('/__t/job-dup', async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { modelName: 'Job', target: ['label'] },
      });
    });
  },
});
const K = { 'x-bot-key': BOT_KEY };
const put = (id: string, payload: object) =>
  w.app.inject({ method: 'PUT', url: `/api/v1/bot/members/${id}`, headers: K, payload });

describe('text helpers (D-1, L-1)', () => {
  it('isCleanText rejects NUL, other control characters and lone surrogates', () => {
    expect(isCleanText('ok แมวกระเป๋า')).toBe(true);
    for (const bad of ['a\u0000b', 'a\nb', 'a\tb', '\u007f', 'a\ud800b', '\udc00'])
      expect(isCleanText(bad)).toBe(false);
  });

  it('nameField strips format/zero-width characters, normalizes NFC, trims, and needs a visible character', () => {
    const p = (s: string) => nameField(64).safeParse(s);
    expect(p('Al\u200bpha').data).toBe('Alpha');
    expect(p('  cafe\u0301 ').data).toBe('café');
    expect(p('a\ufeffb\u202ec\u00ad').data).toBe('abc');
    for (const bad of ['\u202e', '\u200b\u200c\u200d', '   ', '', 'a\u0000', 'a\ud800'])
      expect(p(bad).success).toBe(false);
    expect(p('x'.repeat(65)).success).toBe(false);
    expect(p('แมวกระเป๋า').data).toBe('แมวกระเป๋า');
  });

  it('safeString bounds length and rejects control characters', () => {
    expect(safeString(5).safeParse('abc').success).toBe(true);
    expect(safeString(5).safeParse('a\u0000').success).toBe(false);
    expect(safeString(5).safeParse('toolong').success).toBe(false);
    expect(safeString(5).safeParse('').success).toBe(false);
  });
});

describe('IGN input over HTTP', () => {
  it('NUL bytes and lone surrogates in ign/nickname give 422 VALIDATION_ERROR (bot and admin), nothing written', async () => {
    const admin = await w.signIn({ admin: true });
    const m = await w.member('Target');
    for (const bad of ['a\u0000b', 'a\ud800b']) {
      for (const payload of [
        { ign: bad, job: 'Knight' },
        { ign: 'Fine', nickname: bad, job: 'Knight' },
      ]) {
        const r = await put('880001', payload);
        expect(r.statusCode).toBe(422);
        expect(r.json().error.code).toBe('VALIDATION_ERROR');
      }
      for (const payload of [{ ign: bad }, { nickname: bad }]) {
        const r = await w.app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/members/${m.id}`,
          headers: admin.h,
          payload,
        });
        expect(r.statusCode).toBe(422);
      }
    }
    expect(await w.db.prisma.member.count({ where: { discordId: '880001' } })).toBe(0);
  });

  it('NUL in path params and query filters gives 422, never 500', async () => {
    const admin = await w.signIn({ admin: true });
    const urls = [
      ['GET', '/api/v1/admin/audit-log?actor=a%00b'],
      ['GET', '/api/v1/admin/audit-log?action=a%00b'],
      ['GET', '/api/v1/admin/notifications?eventType=a%00b'],
      ['PATCH', '/api/v1/admin/activities/a%00b'],
      ['PUT', '/api/v1/events/a%00b/occurrences/2026-09-22/registrations/me'],
    ] as const;
    for (const [method, url] of urls) {
      const r = await w.app.inject({
        method,
        url,
        headers: admin.h,
        ...(method === 'GET'
          ? {}
          : { payload: method === 'PATCH' ? { registrationCapacity: 3 } : { status: 'JOINED' } }),
      });
      expect(r.statusCode, url).toBe(422);
      expect(r.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('an IGN made only of invisible/format characters is rejected (201 no longer possible)', async () => {
    for (const ign of ['\u202e', '\u200b', '\u200b\u200d\ufeff', '   ']) {
      const r = await put('880002', { ign, job: 'Knight' });
      expect(r.statusCode, JSON.stringify(ign)).toBe(422);
    }
    expect(await w.db.prisma.member.count()).toBe(0);
  });

  it('zero-width characters cannot defeat IGN uniqueness: they are stripped before storing', async () => {
    const a = await put('880003', { ign: 'Alpha', job: 'Knight' });
    expect(a.statusCode).toBe(201);
    const b = await put('880004', { ign: 'Al\u200bpha', job: 'Knight' });
    expect(b.statusCode).toBe(409);
    expect(b.json().error.code).toBe('DUPLICATE_IGN');
    const c = await put('880005', { ign: 'Be\u200dta', job: 'Knight' });
    expect(c.json().ign).toBe('Beta');
    expect((await w.db.prisma.member.findUniqueOrThrow({ where: { discordId: '880005' } })).ign).toBe('Beta');
  });
});

describe('job labels (L-3)', () => {
  it('a unique violation on Job.label maps to DUPLICATE_JOB_LABEL, not CONFLICT', async () => {
    const r = await w.app.inject('/__t/job-dup');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('DUPLICATE_JOB_LABEL');
  });

  it('racing PUT /admin/jobs that create the same label only ever answer 200 or DUPLICATE_JOB_LABEL', async () => {
    const admin = await w.signIn({ admin: true });
    for (let i = 0; i < 6; i++) {
      const cur = (await w.app.inject({ url: '/api/v1/jobs', headers: admin.h })).json() as {
        id: number;
        label: string;
        color: string;
      }[];
      const keep = cur.map((j) => ({ id: j.id, label: j.label, color: j.color }));
      const rs = await Promise.all(
        Array.from({ length: 4 }, () =>
          w.app.inject({
            method: 'PUT',
            url: '/api/v1/admin/jobs',
            headers: admin.h,
            payload: { jobs: [...keep, { label: `Racer${i}`, color: '#123456' }] },
          }),
        ),
      );
      for (const r of rs) {
        expect([200, 409]).toContain(r.statusCode);
        if (r.statusCode === 409) expect(r.json().error.code).toBe('DUPLICATE_JOB_LABEL');
      }
    }
  });

  it('a NUL byte in a job label is a 422', async () => {
    const admin = await w.signIn({ admin: true });
    const r = await w.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/jobs',
      headers: admin.h,
      payload: { jobs: [{ label: 'a\u0000b', color: '#123456' }] },
    });
    expect(r.statusCode).toBe(422);
  });
});

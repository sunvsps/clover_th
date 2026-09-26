import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';
import { session } from '../auctions/helpers.js';

const w = useWorld();
const me = (h: Record<string, string>) => w.app.inject({ url: '/api/v1/me', headers: h });
const setLanguage = (h: Record<string, string>, payload: object) =>
  w.app.inject({ method: 'PUT', url: '/api/v1/me/language', headers: h, payload });

describe('remembered UI language', () => {
  it('is English until picked, then /me returns the last one picked', async () => {
    const a = await session(w);
    expect((await me(a.h)).json().language).toBe('en');
    const th = await setLanguage(a.h, { language: 'th' });
    expect(th.statusCode).toBe(200);
    expect(th.json()).toEqual({ language: 'th' });
    expect((await me(a.h)).json().language).toBe('th');
    await setLanguage(a.h, { language: 'en' });
    expect((await me(a.h)).json().language).toBe('en');
    expect((await w.db.prisma.member.findUniqueOrThrow({ where: { id: a.id } })).language).toBe('en');
  });

  it('is per member, rejects other values, and needs a session', async () => {
    const a = await session(w);
    const b = await session(w);
    await setLanguage(a.h, { language: 'th' });
    expect((await me(b.h)).json().language).toBe('en');
    expect((await setLanguage(a.h, { language: 'fr' })).statusCode).toBe(422);
    expect((await setLanguage(a.h, {})).statusCode).toBe(422);
    const { cookie: _c, ...noCookie } = a.h;
    void _c;
    expect((await setLanguage(noCookie, { language: 'th' })).statusCode).toBe(401);
  });
});

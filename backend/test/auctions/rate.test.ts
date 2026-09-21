import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';
import { api, openRound, session } from './helpers.js';

// default CLAIM_RATE_MAX (5 per second per member)
const w = useWorld();
const A = api(w);

describe('WP8 claim rate limit', () => {
  it('a member is limited to 5 claim/release requests per second (429 RATE_LIMITED); other members are unaffected', async () => {
    const admin = await session(w, { admin: true });
    const a = await session(w);
    const b = await session(w);
    const r = await openRound(w, admin, { itemCount: 12, winCap: 12 });
    const rs = [];
    for (const id of r.itemIds.slice(0, 8)) rs.push(await A.claim(a.h, r.id, id));
    expect(rs.filter((x) => x.statusCode === 200)).toHaveLength(5);
    const limited = rs.filter((x) => x.statusCode === 429);
    expect(limited).toHaveLength(3);
    expect(limited[0]!.json().error.code).toBe('RATE_LIMITED');
    expect((await A.claim(b.h, r.id, r.itemIds[9]!)).statusCode).toBe(200);
    expect(await w.db.prisma.auctionItem.count({ where: { winnerId: a.id } })).toBe(5);
  });
});

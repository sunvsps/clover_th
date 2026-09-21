import { describe, expect, it } from 'vitest';
import { futureDate } from '../helpers/dates.js';
import { useWorld } from '../helpers/world.js';
import { api } from './helpers.js';
import { makeScene } from './scene.js';

const w = useWorld({ env: { NOTIFICATIONS_PROVIDER: 'fake' } });
const A = api(w);
const scene = makeScene(w, A);
const PZ = 'polarity-zone';
type H = Record<string, string>;

const reg = (h: H, date: string, memberId: string, status: string) =>
  w.app.inject({
    method: 'PUT',
    url: `/api/v1/events/${PZ}/occurrences/${date}/registrations/${memberId}`,
    headers: h,
    payload: { status },
  });
const undo = (h: H, date: string, memberId: string, expectedVersion: number) =>
  w.app.inject({
    method: 'POST',
    url: `/api/v1/events/${PZ}/occurrences/${date}/plan/placements/${memberId}/undo-backfill`,
    headers: h,
    payload: { expectedVersion },
  });
const outbox = () => w.db.prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' } });

describe('WP7b undo-backfill (FR-5.17)', () => {
  it('returns the promoted member to the reserves at their original position, audits plan.backfill.undo, cancels pending messages and sends none', async () => {
    const admin = await w.signIn({ admin: true });
    await w.db.prisma.activity.update({ where: { id: PZ }, data: { notifyChannelId: '123456789012345678' } });
    const s = await scene({ placed: 2, reserves: 3 });
    const [r1, r2, r3] = s.reserves;
    await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE'); // R1 promoted, version 1
    expect(await outbox()).toHaveLength(2);

    const res = await undo(admin.h, s.date, r1!.id, 1);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 2, cancelledNotifications: 2 });
    expect(await outbox()).toHaveLength(0); // still-pending rows of that promotion are cancelled
    expect(await w.db.prisma.placement.count({ where: { memberId: r1!.id } })).toBe(0);
    const log = await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'plan.backfill.undo' } });
    expect(log).toMatchObject({ actorId: admin.id, entityId: String(s.occ.id) });
    expect(log.meta).toMatchObject({ memberId: r1!.id, slot: 1, vacatedMemberId: s.placed[0]!.id });
    // R1 is back in the reserve list at the front (original registeredAt), ahead of R2 and R3
    const plan = (await A.plan(admin.h, PZ, s.date)).json();
    expect(plan.reserves.map((x: { memberId: string }) => x.memberId)).toEqual([r1!.id, r2!.id, r3!.id]);
    // undo does not trigger another backfill: the slot stays empty
    expect(await w.db.prisma.placement.count({ where: { source: 'AUTO_BACKFILL' } })).toBe(0);
    expect(await w.db.prisma.auditLog.count({ where: { action: 'plan.backfill' } })).toBe(1);
  });

  it('messages already SENT (or being sent) are not touched', async () => {
    const admin = await w.signIn({ admin: true });
    await w.db.prisma.activity.update({ where: { id: PZ }, data: { notifyChannelId: '123456789012345678' } });
    const s = await scene({ placed: 1, reserves: 1 });
    await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE');
    const [dm] = await outbox();
    await w.db.prisma
      .$executeRaw`UPDATE "NotificationOutbox" SET status = 'SENT', "sentAt" = clock_timestamp() WHERE id = ${dm!.id}`;
    const res = await undo(admin.h, s.date, s.reserves[0]!.id, 1);
    expect(res.json().cancelledNotifications).toBe(1);
    expect((await outbox()).map((r) => r.status)).toEqual(['SENT']);
  });

  it('only for AUTO_BACKFILL placements: others give NOT_AN_AUTO_BACKFILL 409; no placement is 404; stale version conflicts; non-admin refused', async () => {
    const admin = await w.signIn({ admin: true });
    const me = await w.signIn();
    const s = await scene({ placed: 2, reserves: 1 });
    expect((await undo(admin.h, s.date, s.placed[0]!.id, 0)).json().error.code).toBe('NOT_AN_AUTO_BACKFILL');
    expect((await undo(admin.h, s.date, s.reserves[0]!.id, 0)).statusCode).toBe(404);
    expect((await undo(me.h, s.date, s.placed[0]!.id, 0)).json().error.code).toBe('ADMIN_REQUIRED');
    await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE');
    const stale = await undo(admin.h, s.date, s.reserves[0]!.id, 0);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('PLAN_VERSION_CONFLICT');
    expect(await w.db.prisma.placement.count({ where: { source: 'AUTO_BACKFILL' } })).toBe(1);
    // an occurrence that does not exist yet has nothing to undo (and is not created)
    const before = await w.db.prisma.occurrence.count();
    expect((await undo(admin.h, futureDate(6, 3), s.reserves[0]!.id, 0)).statusCode).toBe(404);
    expect(await w.db.prisma.occurrence.count()).toBe(before);
  });

  it('if the promoted member withdrew after promotion (and was replaced), undoing them is a clean 404 and state stays consistent', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 1, reserves: 2 });
    const [r1, r2] = s.reserves;
    await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE'); // R1 into slot 1 (v1)
    await reg(admin.h, s.date, r1!.id, 'LEAVE'); // R1 withdraws -> R2 into slot 1 (v2)
    const gone = await undo(admin.h, s.date, r1!.id, 2);
    expect(gone.statusCode).toBe(404);
    const plan = (await A.plan(admin.h, PZ, s.date)).json();
    expect(plan.version).toBe(2);
    expect(plan.rooms[0].teams[0].placements).toHaveLength(1);
    expect(plan.rooms[0].teams[0].placements[0].memberId).toBe(r2!.id);
    // undoing the current holder still works
    expect((await undo(admin.h, s.date, r2!.id, 2)).statusCode).toBe(200);
  });

  it('an ordinary move of a backfilled member resets source to ADMIN, so undo no longer applies', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 1, reserves: 1 });
    await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE');
    await A.place(admin.h, PZ, s.date, s.reserves[0]!.id, { teamId: s.teams[3]!.id, expectedVersion: 1 });
    const p = await w.db.prisma.placement.findFirstOrThrow({ where: { memberId: s.reserves[0]!.id } });
    expect(p.source).toBe('ADMIN');
    expect((await undo(admin.h, s.date, s.reserves[0]!.id, 2)).json().error.code).toBe(
      'NOT_AN_AUTO_BACKFILL',
    );
  });
});

describe('WP7b deactivation hook', () => {
  it('deactivating a placed Polarity Zone member backfills their slot with reason DEACTIVATED (bot and admin paths), message enqueued', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 3, reserves: 2 });
    const target = s.placed[1]!;
    const r = await w.app.inject({
      method: 'POST',
      url: `/api/v1/admin/members/${target.id}/deactivate`,
      headers: admin.h,
    });
    expect(r.statusCode).toBe(200);
    const p = await w.db.prisma.placement.findFirstOrThrow({ where: { memberId: s.reserves[0]!.id } });
    expect(p).toMatchObject({
      teamId: s.teams[0]!.id,
      slot: 2,
      source: 'AUTO_BACKFILL',
      backfillReason: 'DEACTIVATED',
      backfilledForMemberId: target.id,
    });
    expect(await w.db.prisma.placement.count({ where: { memberId: target.id } })).toBe(0);
    expect((await A.occ(PZ, s.date)).planVersion).toBe(1);
    const rows = await outbox();
    expect(rows).toHaveLength(1); // DM only: no channel configured
    expect(rows[0]!.payload).toMatchObject({ reason: 'DEACTIVATED', promotedMemberId: s.reserves[0]!.id });
    expect(await w.db.prisma.auditLog.count({ where: { action: 'plan.backfill' } })).toBe(1);
  });

  it('bot deactivation backfills too; and with autoBackfill OFF the deactivated member is removed but nobody is promoted', async () => {
    const s = await scene({ placed: 2, reserves: 1 });
    const K = { 'x-bot-key': 'test-bot-key-primary-000000000000' };
    const m1 = s.placed[0]!;
    const d1 = await w.db.prisma.member.findUniqueOrThrow({ where: { id: m1.id } });
    await w.app.inject({ method: 'POST', url: `/api/v1/bot/members/${d1.discordId}/deactivate`, headers: K });
    expect(
      await w.db.prisma.placement.count({
        where: { source: 'AUTO_BACKFILL', backfillReason: 'DEACTIVATED' },
      }),
    ).toBe(1);

    await w.db.prisma.activity.update({ where: { id: PZ }, data: { autoBackfill: false } });
    const m2 = s.placed[1]!;
    const d2 = await w.db.prisma.member.findUniqueOrThrow({ where: { id: m2.id } });
    await w.app.inject({ method: 'POST', url: `/api/v1/bot/members/${d2.discordId}/deactivate`, headers: K });
    expect(await w.db.prisma.placement.count({ where: { memberId: m2.id } })).toBe(0);
    expect(await w.db.prisma.placement.count()).toBe(1); // only the earlier backfilled reserve remains
  });
});

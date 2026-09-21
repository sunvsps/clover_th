import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../../src/modules/notifications/providers/fake.js';
import { createWorker } from '../../src/modules/notifications/worker.js';
import { pastDate } from '../helpers/dates.js';
import { makeScene } from './scene.js';
import { useWorld } from '../helpers/world.js';
import { api } from './helpers.js';

const w = useWorld({ env: { NOTIFICATIONS_PROVIDER: 'fake' } });
const A = api(w);
const scene = makeScene(w, A);
const PZ = 'polarity-zone'; // Sunday, autoBackfill ON, 10 teams x 5
const CHANNEL = '123456789012345678';
type H = Record<string, string>;

const reg = (h: H, date: string, memberId: string, status: string) =>
  w.app.inject({
    method: 'PUT',
    url: `/api/v1/events/${PZ}/occurrences/${date}/registrations/${memberId}`,
    headers: h,
    payload: { status },
  });
const placementOf = (occurrenceId: number, memberId: string) =>
  w.db.prisma.placement.findUnique({ where: { occurrenceId_memberId: { occurrenceId, memberId } } });
const count = (action: string) => w.db.prisma.auditLog.count({ where: { action } });
const outbox = () => w.db.prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' } });

describe('WP7b backfill (AC-10)', () => {
  it('50 placed, reserves R1 (earlier) and R2: a placed member setting leave puts R1 in that exact team and slot; one audit row; one DM + one channel row; repeating does not promote R2', async () => {
    const admin = await w.signIn({ admin: true });
    await w.db.prisma.activity.update({ where: { id: PZ }, data: { notifyChannelId: CHANNEL } });
    const s = await scene({ placed: 50, reserves: 2 });
    const [r1, r2] = s.reserves;
    const target = s.placed[12]!; // team 3 (index 2), slot 3
    const res = await reg(admin.h, s.date, target.id, 'LEAVE');
    expect(res.statusCode).toBe(200);
    expect(res.json().backfilled).toEqual([
      {
        teamId: s.teams[2]!.id,
        teamName: s.teams[2]!.name,
        slot: 3,
        vacatedMemberId: target.id,
        promotedMemberId: r1!.id,
        reason: 'LEAVE',
      },
    ]);
    expect(res.json().planVersion).toBe(1);
    expect(await placementOf(s.occ.id, target.id)).toBeNull();
    expect(await placementOf(s.occ.id, r1!.id)).toMatchObject({
      teamId: s.teams[2]!.id,
      slot: 3,
      source: 'AUTO_BACKFILL',
      backfilledForMemberId: target.id,
      backfillReason: 'LEAVE',
      placedById: null,
    });
    expect(await placementOf(s.occ.id, r2!.id)).toBeNull();
    expect(await count('plan.backfill')).toBe(1);
    const rows = await outbox();
    expect(rows.map((r) => r.target)).toEqual(['DISCORD_DM', 'DISCORD_CHANNEL']);
    expect(rows[0]).toMatchObject({
      recipientMemberId: r1!.id,
      eventType: 'reserve.promoted',
      entityId: String(s.occ.id),
    });
    expect(rows[0]!.payload).toMatchObject({
      promotedIgn: r1!.ign,
      vacatedIgn: target.ign,
      slot: 3,
      teamName: s.teams[2]!.name,
      reason: 'LEAVE',
      planVersion: 1,
    });
    // repeating the same request (retry) changes nothing
    const again = await reg(admin.h, s.date, target.id, 'LEAVE');
    expect(again.json()).toMatchObject({ status: 'LEAVE', promoted: [], backfilled: [], planVersion: 1 });
    expect(await placementOf(s.occ.id, r2!.id)).toBeNull();
    expect(await count('plan.backfill')).toBe(1);
    expect(await outbox()).toHaveLength(2);
    expect((await A.occ(PZ, s.date)).planVersion).toBe(1);
    // the reserve list no longer has R1 and the plan shows the source
    const plan = (await A.plan(admin.h, PZ, s.date)).json();
    expect(plan.reserves.map((x: { memberId: string }) => x.memberId)).toEqual([r2!.id]);
    const p = plan.rooms[0].teams[2].placements.find((x: { slot: number }) => x.slot === 3);
    expect(p).toMatchObject({
      memberId: r1!.id,
      source: 'AUTO_BACKFILL',
      backfill: { vacatedMemberId: target.id, reason: 'LEAVE' },
    });
  });

  it('unregistering (NONE) backfills with reason UNREGISTERED', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 3, reserves: 1 });
    const res = await reg(admin.h, s.date, s.placed[1]!.id, 'NONE');
    expect(res.json().backfilled[0]).toMatchObject({
      slot: 2,
      reason: 'UNREGISTERED',
      promotedMemberId: s.reserves[0]!.id,
    });
    expect(
      await w.db.prisma.registration.count({ where: { occurrenceId: s.occ.id, memberId: s.placed[1]!.id } }),
    ).toBe(0);
  });

  it('a member can withdraw themselves (no admin needed) and the backfill still runs', async () => {
    const me = await w.signIn();
    const s = await scene({ placed: 0, reserves: 1 });
    await w.db.prisma.registration.create({
      data: {
        occurrenceId: s.occ.id,
        memberId: me.id,
        status: 'JOINED',
        registeredAt: new Date(Date.now() - 4_000_000),
      },
    });
    await A.put(s.occ.id, me.id, s.teams[0]!.id, 4);
    const res = await reg(me.h, s.date, 'me', 'LEAVE');
    expect(res.json().backfilled[0]).toMatchObject({ slot: 4, promotedMemberId: s.reserves[0]!.id });
  });

  it('with no reserves the member is still removed and the slot stays empty (audited plan.vacated, no message, one version bump)', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 2, reserves: 0 });
    const res = await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE');
    expect(res.json()).toMatchObject({ status: 'LEAVE', backfilled: [], planVersion: 1 });
    expect(await placementOf(s.occ.id, s.placed[0]!.id)).toBeNull();
    expect(await w.db.prisma.placement.count()).toBe(1);
    expect(
      (await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'plan.vacated' } })).meta,
    ).toMatchObject({ noReserve: true, slot: 1 });
    expect(await outbox()).toHaveLength(0);
  });

  it('ineligible reserves are skipped: on leave, unregistered, deactivated, already placed; the next eligible one is used', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 1, reserves: 5 });
    const [onLeave, gone, waitlisted, placedElsewhere, good] = s.reserves; // waitlisted -> unregistered
    await reg(admin.h, s.date, onLeave!.id, 'LEAVE');
    await w.db.prisma.member.update({ where: { id: gone!.id }, data: { isActive: false } });
    await reg(admin.h, s.date, waitlisted!.id, 'NONE');
    await A.put(s.occ.id, placedElsewhere!.id, s.teams[5]!.id, 1);
    const res = await reg(admin.h, s.date, s.placed[0]!.id, 'NONE');
    expect(res.json().backfilled[0]).toMatchObject({ promotedMemberId: good!.id });
  });

  it('reserve order is (registeredAt, id): a member who toggled leave -> joined goes to the back', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 2, reserves: 2 });
    const [r1, r2] = s.reserves;
    await reg(admin.h, s.date, r1!.id, 'LEAVE');
    await reg(admin.h, s.date, r1!.id, 'JOINED'); // resets registeredAt: now after R2
    const first = await reg(admin.h, s.date, s.placed[0]!.id, 'NONE');
    expect(first.json().backfilled[0].promotedMemberId).toBe(r2!.id);
    const second = await reg(admin.h, s.date, s.placed[1]!.id, 'NONE');
    expect(second.json().backfilled[0].promotedMemberId).toBe(r1!.id);
  });

  it('chained: a promoted member who later withdraws backfills again through the same path', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 1, reserves: 2 });
    const [r1, r2] = s.reserves;
    await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE');
    const res = await reg(admin.h, s.date, r1!.id, 'NONE');
    expect(res.json().backfilled[0]).toMatchObject({
      vacatedMemberId: r1!.id,
      promotedMemberId: r2!.id,
      slot: 1,
    });
    expect(await placementOf(s.occ.id, r1!.id)).toBeNull();
    expect(await placementOf(s.occ.id, r2!.id)).toMatchObject({ slot: 1, backfilledForMemberId: r1!.id });
    expect(await count('plan.backfill')).toBe(2);
    expect((await A.occ(PZ, s.date)).planVersion).toBe(2);
  });

  it('no backfill once startsAt has passed, but the withdrawing member is still removed (admin only)', async () => {
    const admin = await w.signIn({ admin: true });
    const date = pastDate(6);
    const s = await scene({ placed: 1, reserves: 1, date });
    await w.db.prisma.occurrence.update({
      where: { id: s.occ.id },
      data: { startsAt: new Date(Date.now() - 3600e3) },
    });
    const member = await w.signIn();
    await w.db.prisma.registration.create({
      data: { occurrenceId: s.occ.id, memberId: member.id, status: 'JOINED', registeredAt: new Date() },
    });
    expect((await reg(member.h, date, 'me', 'LEAVE')).json().error.code).toBe('REGISTRATION_CLOSED');
    const res = await reg(admin.h, date, s.placed[0]!.id, 'LEAVE');
    expect(res.statusCode).toBe(200);
    expect(res.json().backfilled).toEqual([]);
    expect(await placementOf(s.occ.id, s.placed[0]!.id)).toBeNull();
    expect(await placementOf(s.occ.id, s.reserves[0]!.id)).toBeNull();
    expect(
      (await w.db.prisma.auditLog.findFirstOrThrow({ where: { action: 'plan.vacated' } })).meta,
    ).toMatchObject({ afterStart: true });
    expect(await outbox()).toHaveLength(0);
  });

  it('backfill does not fire when an admin unplaces or moves someone (FR-5.19), and an empty slot is never filled (FR-5.20)', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 3, reserves: 2 });
    const r = await A.place(admin.h, PZ, s.date, s.placed[0]!.id, { teamId: null, expectedVersion: 0 });
    expect(r.json()).toEqual({ version: 1 });
    await A.place(admin.h, PZ, s.date, s.placed[1]!.id, { teamId: s.teams[1]!.id, expectedVersion: 1 });
    expect(await count('plan.backfill')).toBe(0);
    expect(await w.db.prisma.placement.count({ where: { source: 'AUTO_BACKFILL' } })).toBe(0);
    for (const m of s.reserves) expect(await placementOf(s.occ.id, m.id)).toBeNull();
    // a later withdrawal elsewhere fills only ITS slot, not the slot the admin emptied
    const res = await reg(admin.h, s.date, s.placed[2]!.id, 'LEAVE');
    // the member the admin unplaced is still JOINED, so they are (the earliest) reserve and take the vacated slot 3
    expect(res.json().backfilled[0]).toMatchObject({ slot: 3, promotedMemberId: s.placed[0]!.id });
    expect(await w.db.prisma.placement.count({ where: { teamId: s.teams[0]!.id, slot: 1 } })).toBe(0);
  });

  it('with autoBackfill OFF a withdrawal promotes nobody and the placement stays (flagged via regStatus)', async () => {
    const admin = await w.signIn({ admin: true });
    await w.db.prisma.activity.update({ where: { id: PZ }, data: { autoBackfill: false } });
    const s = await scene({ placed: 2, reserves: 1 });
    const res = await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE');
    expect(res.json()).toMatchObject({ status: 'LEAVE', backfilled: [], planVersion: 0 });
    expect(await placementOf(s.occ.id, s.placed[0]!.id)).not.toBeNull();
    expect(await placementOf(s.occ.id, s.reserves[0]!.id)).toBeNull();
    const plan = (await A.plan(admin.h, PZ, s.date)).json();
    expect(plan.rooms[0].teams[0].placements[0].regStatus).toBe('LEAVE');
    expect(await outbox()).toHaveLength(0);
  });

  it('trigger is a real transition out of JOINED: a placed member already on LEAVE moving to NONE triggers nothing', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 1, reserves: 1 });
    const m = s.placed[0]!;
    await w.db.prisma.registration.update({
      where: { occurrenceId_memberId: { occurrenceId: s.occ.id, memberId: m.id } },
      data: { status: 'LEAVE' },
    }); // placed with a warning (FR-5.6)
    const res = await reg(admin.h, s.date, m.id, 'NONE');
    expect(res.json()).toMatchObject({ status: 'NONE', backfilled: [], planVersion: 0 });
    expect(await placementOf(s.occ.id, m.id)).not.toBeNull(); // stays for an admin to resolve
    expect(await count('plan.backfill')).toBe(0);
    // an unplaced member withdrawing simply leaves the reserve list
    const r = await reg(admin.h, s.date, s.reserves[0]!.id, 'LEAVE');
    expect(r.json().backfilled).toEqual([]);
  });

  it('waitlist + capacity + backfill ordering: a freed seat promotes the waitlist first, and the promoted member is then an eligible reserve ordered by registeredAt', async () => {
    const admin = await w.signIn({ admin: true });
    await w.db.prisma.activity.update({ where: { id: PZ }, data: { registrationCapacity: 4 } });
    const s = await scene({ placed: 1, reserves: 3 }); // 4 JOINED = capacity
    const late = (await A.members(1, 'Late'))[0]!;
    await w.db.prisma.registration.create({
      data: { occurrenceId: s.occ.id, memberId: late.id, status: 'WAITLISTED', registeredAt: new Date() },
    });
    const res = await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE');
    const body = res.json();
    expect(body.promoted).toEqual([late.id]); // waitlist promotion happened
    // the earliest-registered reserve (R1), not the just-promoted waitlister, takes the slot
    expect(body.backfilled[0].promotedMemberId).toBe(s.reserves[0]!.id);
    const plan = (await A.plan(admin.h, PZ, s.date)).json();
    expect(plan.reserves.map((x: { memberId: string }) => x.memberId)).toEqual([
      s.reserves[1]!.id,
      s.reserves[2]!.id,
      late.id,
    ]);
  });

  it('promotion commits even when the provider is down: outbox rows stay PENDING and are retried later', async () => {
    const admin = await w.signIn({ admin: true });
    const s = await scene({ placed: 1, reserves: 1 });
    await reg(admin.h, s.date, s.placed[0]!.id, 'LEAVE');
    const fake = new FakeProvider();
    fake.queue({ ok: false, kind: 'retry', code: 'HTTP_503', message: 'down' });
    await createWorker({ prisma: w.db.prisma, provider: fake, sendIntervalMs: 0, jitter: () => 0 }).tick();
    expect(await placementOf(s.occ.id, s.reserves[0]!.id)).toMatchObject({ source: 'AUTO_BACKFILL' });
    expect((await outbox())[0]).toMatchObject({ status: 'PENDING', attempts: 1, lastErrorCode: 'HTTP_503' });
  });
});

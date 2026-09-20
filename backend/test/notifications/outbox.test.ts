import { describe, expect, it } from 'vitest';
import { enqueueNotifications } from '../../src/modules/notifications/outbox.js';
import { useWorld } from '../helpers/world.js';
import { promotedPayload } from './payload.js';

const w = useWorld();
const tx = <T>(
  fn: Parameters<typeof w.app.tx>[0] extends (t: infer X) => unknown ? (t: X) => Promise<T> : never,
) => w.app.tx(fn as never) as Promise<T>;

describe('WP5 outbox producer', () => {
  it('enqueue in a transaction that then rolls back leaves no row', async () => {
    const m = await w.member('Promo');
    const p = promotedPayload(m);
    await expect(
      tx(async (t) => {
        await enqueueNotifications(t, 'fake', 'reserve.promoted', p);
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    expect(await w.db.prisma.notificationOutbox.count()).toBe(0);
  });

  it('duplicate dedupeKey inserts one row per target', async () => {
    const m = await w.member('Promo');
    await w.db.prisma.activity.update({
      where: { id: 'polarity-zone' },
      data: { notifyChannelId: '123456789012345678' },
    });
    const p = promotedPayload(m);
    expect(await tx((t) => enqueueNotifications(t, 'fake', 'reserve.promoted', p))).toBe(2);
    expect(await tx((t) => enqueueNotifications(t, 'fake', 'reserve.promoted', p))).toBe(0);
    const rows = await w.db.prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.target)).toEqual(['DISCORD_DM', 'DISCORD_CHANNEL']);
    expect(rows[0]).toMatchObject({
      recipientMemberId: m.id,
      recipientDiscordId: m.discordId,
      status: 'PENDING',
      entityType: 'occurrence',
    });
    expect(rows[1]).toMatchObject({ channelId: '123456789012345678', recipientMemberId: null });
    expect(rows[0]!.dedupeKey).toBe(`reserve.promoted:${p.occurrenceId}:${m.id}:${p.planVersion}:dm`);
    // a new plan version is a new promotion
    expect(
      await tx((t) =>
        enqueueNotifications(t, 'fake', 'reserve.promoted', { ...p, planVersion: p.planVersion + 1 }),
      ),
    ).toBe(2);
  });

  it('no channel row is created when no channel id is configured', async () => {
    const m = await w.member('Promo');
    expect(await tx((t) => enqueueNotifications(t, 'fake', 'reserve.promoted', promotedPayload(m)))).toBe(1);
    expect((await w.db.prisma.notificationOutbox.findMany()).map((r) => r.target)).toEqual(['DISCORD_DM']);
  });

  it('with provider off, no rows are created', async () => {
    const m = await w.member('Promo');
    await w.db.prisma.activity.update({
      where: { id: 'polarity-zone' },
      data: { notifyChannelId: '123456789012345678' },
    });
    expect(await tx((t) => enqueueNotifications(t, 'off', 'reserve.promoted', promotedPayload(m)))).toBe(0);
    expect(await w.db.prisma.notificationOutbox.count()).toBe(0);
  });

  it('a forced enqueue failure rolls the business transaction back (no swallowed error)', async () => {
    const m = await w.member('Promo');
    const bad = { ...promotedPayload(m), promotedMemberId: '00000000-0000-4000-8000-000000000000' };
    await expect(
      tx(async (t) => {
        await t.job.create({ data: { label: 'Business row', color: '#000000' } });
        await enqueueNotifications(t, 'fake', 'reserve.promoted', bad);
      }),
    ).rejects.toMatchObject({ code: 'P2010' });
    expect(await w.db.prisma.job.count({ where: { label: 'Business row' } })).toBe(0);
    expect(await w.db.prisma.notificationOutbox.count()).toBe(0);
  });

  it('an unknown event type is an error, not a silent skip', async () => {
    await expect(tx((t) => enqueueNotifications(t, 'fake', 'nope', {}))).rejects.toThrow(
      /Unknown notification event type/,
    );
  });
});

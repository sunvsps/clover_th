import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';

const w = useWorld();
const seedRows = async () => {
  const ins = (key: string, status: string, attempts = 0) =>
    w.db.prisma
      .$executeRaw`INSERT INTO "NotificationOutbox" ("eventType", target, "channelId", payload, "dedupeKey", status, attempts, "lastErrorCode")
      VALUES ('reserve.promoted', 'DISCORD_CHANNEL', '1', '{"promotedIgn":"X"}'::jsonb, ${key}, ${status}::"NotifyStatus", ${attempts}::int, 'HTTP_503')`;
  await ins('a', 'DEAD', 8);
  await ins('b', 'SENT', 1);
  await ins('c', 'PENDING');
};

describe('WP5 admin notification routes', () => {
  it('lists with counts and filters; non-admins are refused', async () => {
    await seedRows();
    const admin = await w.signIn({ admin: true });
    const all = (await w.app.inject({ url: '/api/v1/admin/notifications', headers: admin.h })).json();
    expect(all.items).toHaveLength(3);
    expect(all.counts).toEqual({ PENDING: 1, SENDING: 0, SENT: 1, DEAD: 1 });
    const dead = (
      await w.app.inject({ url: '/api/v1/admin/notifications?status=DEAD', headers: admin.h })
    ).json();
    expect(dead.items).toHaveLength(1);
    expect(dead.items[0]).toMatchObject({
      status: 'DEAD',
      lastErrorCode: 'HTTP_503',
      payload: { promotedIgn: 'X' },
    });
    expect(dead.items[0]).not.toHaveProperty('recipientDiscordId');
    const page = (
      await w.app.inject({ url: '/api/v1/admin/notifications?limit=2', headers: admin.h })
    ).json();
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const me = await w.signIn();
    expect((await w.app.inject({ url: '/api/v1/admin/notifications', headers: me.h })).statusCode).toBe(403);
  });

  it('retry: DEAD goes back to PENDING now with a fresh budget (audited); SENT is not retryable; unknown is 404', async () => {
    await seedRows();
    const admin = await w.signIn({ admin: true });
    const rows = await w.db.prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' } });
    const [dead, sent] = rows;
    const r = await w.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${dead!.id}/retry`,
      headers: admin.h,
    });
    expect(r.statusCode).toBe(200);
    expect(await w.db.prisma.notificationOutbox.findUniqueOrThrow({ where: { id: dead!.id } })).toMatchObject(
      { status: 'PENDING', attempts: 0 },
    );
    expect(
      await w.db.prisma.auditLog.count({ where: { action: 'notification.retry', actorId: admin.id } }),
    ).toBe(1);
    const bad = await w.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${sent!.id}/retry`,
      headers: admin.h,
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.code).toBe('NOTIFICATION_NOT_RETRYABLE');
    expect(
      (
        await w.app.inject({
          method: 'POST',
          url: '/api/v1/admin/notifications/99999/retry',
          headers: admin.h,
        })
      ).statusCode,
    ).toBe(404);
  });
});

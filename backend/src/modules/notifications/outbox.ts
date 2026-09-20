import type { Env } from '../../config/env.js';
import type { Tx } from '../../lib/tx.js';
import { templateFor } from './templates/index.js';

/**
 * Producer (design 8.1). Runs INSIDE the business transaction, with no savepoint: the message commits
 * atomically with the promotion, and a failed enqueue rolls the business transaction back (it is a bug,
 * not something to swallow). No network I/O happens here, so Discord being down can never block a promotion.
 * Returns the number of rows actually inserted (duplicates of a dedupeKey insert nothing).
 */
export async function enqueueNotifications(
  tx: Tx,
  provider: Env['NOTIFICATIONS_PROVIDER'],
  eventType: string,
  payload: Record<string, unknown>,
): Promise<number> {
  if (provider === 'off') return 0;
  const t = templateFor(eventType);
  const p = payload as Record<string, never>;
  const [act] = await tx.$queryRaw<{ notifyChannelId: string | null }[]>`
    SELECT "notifyChannelId" FROM "Activity" WHERE id = ${t.activityId(p)}`;
  const channelId = act?.notifyChannelId ?? null;
  const base = t.dedupeBase(p);
  const entity = t.entity(p);
  const recipient = t.recipient(p);
  const json = JSON.stringify(payload);
  let inserted = 0;

  for (const target of t.targets) {
    if (target === 'DISCORD_CHANNEL' && !channelId) continue; // FR-6.2: no channel id, no channel post
    if (target === 'DISCORD_DM' && !recipient) continue;
    const dm = target === 'DISCORD_DM';
    const rows = await tx.$queryRaw<{ id: number }[]>`
      INSERT INTO "NotificationOutbox"
        ("eventType", target, "recipientMemberId", "recipientDiscordId", "channelId", payload, "dedupeKey", "entityType", "entityId")
      VALUES (${eventType}, ${target}::"NotifyTarget",
              ${dm ? recipient!.memberId : null}::uuid, ${dm ? recipient!.discordId : null}::text,
              ${dm ? null : channelId}::text, ${json}::jsonb,
              ${`${base}:${dm ? 'dm' : 'channel'}`}, ${entity.type}, ${entity.id})
      ON CONFLICT ("dedupeKey") DO NOTHING
      RETURNING id`;
    inserted += rows.length;
  }
  return inserted;
}

import { DateTime } from 'luxon';
import { BANGKOK } from '../../../lib/time.js';
import type { ReservePromotedPayload } from '../types.js';

export type Target = 'DISCORD_DM' | 'DISCORD_CHANNEL';

export type Template<P> = {
  targets: Target[];
  activityId(p: P): string;
  dedupeBase(p: P): string;
  recipient(p: P): { memberId: string; discordId: string } | null;
  entity(p: P): { type: string; id: string };
  render(p: P, target: Target, locale?: 'th'): { content: string; mentionUserIds: string[] };
};

/** Escapes markdown and defuses @mentions in user-controlled text (IGNs). */
export function escapeDiscord(s: string): string {
  return s.replace(/([\\*_~`|>[\]()])/g, '\\$1').replace(/@/g, '@\u200b');
}

const reservePromoted: Template<ReservePromotedPayload> = {
  targets: ['DISCORD_DM', 'DISCORD_CHANNEL'],
  activityId: (p) => p.activityId,
  dedupeBase: (p) => `reserve.promoted:${p.occurrenceId}:${p.promotedMemberId}:${p.planVersion}`,
  recipient: (p) => ({ memberId: p.promotedMemberId, discordId: p.promotedDiscordId }),
  entity: (p) => ({ type: 'occurrence', id: String(p.occurrenceId) }),
  render(p, target) {
    const at = DateTime.fromISO(p.startsAt, { zone: 'utc' }).setZone(BANGKOK);
    const when = `วันที่ ${at.toFormat('dd/MM/yyyy')} เวลา ${at.toFormat('HH:mm')} น.`;
    const where = `ห้อง ${escapeDiscord(p.roomName)} ทีม ${escapeDiscord(p.teamName)} ช่อง ${p.slot}`;
    const activity = escapeDiscord(p.activityName);
    const content =
      target === 'DISCORD_DM'
        ? `คุณได้ขึ้นเป็นตัวจริงในกิจกรรม ${activity} ${when} ${where} (แทน ${escapeDiscord(p.vacatedIgn)})`
        : `${escapeDiscord(p.promotedIgn)} (<@${p.promotedDiscordId}>) ได้ขึ้นเป็นตัวจริงในกิจกรรม ${activity} ${when} ${where} แทน ${escapeDiscord(p.vacatedIgn)}`;
    return { content, mentionUserIds: [p.promotedDiscordId] };
  },
};

// Adding a future event = adding an entry here (and a routing table only if per-event routing is ever needed).
export const templates: Record<string, Template<never>> = {
  'reserve.promoted': reservePromoted as unknown as Template<never>,
};

export function templateFor(eventType: string): Template<Record<string, never>> {
  const t = templates[eventType];
  if (!t) throw new Error(`Unknown notification event type: ${eventType}`);
  return t as unknown as Template<Record<string, never>>;
}

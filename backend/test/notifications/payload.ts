import type { ReservePromotedPayload } from '../../src/modules/notifications/types.js';

export const promotedPayload = (
  promoted: { id: string; discordId: string; ign: string },
  over: Partial<ReservePromotedPayload> = {},
): ReservePromotedPayload => ({
  occurrenceId: 1,
  activityId: 'polarity-zone',
  activityName: 'Polarity Zone',
  date: '2026-09-27',
  startsAt: '2026-09-27T05:00:00.000Z',
  roomName: 'Main',
  teamId: 3,
  teamName: 'Team 3',
  slot: 2,
  promotedMemberId: promoted.id,
  promotedDiscordId: promoted.discordId,
  promotedIgn: promoted.ign,
  vacatedMemberId: '11111111-1111-4111-8111-111111111111',
  vacatedIgn: 'Vacater',
  reason: 'LEAVE',
  planVersion: 4,
  ...over,
});

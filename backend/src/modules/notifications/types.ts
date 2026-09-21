export type OutboundMessage = {
  /** Outbox row id. */
  id: number;
  eventType: string;
  target: 'DM' | 'CHANNEL';
  discordUserId?: string;
  channelId?: string;
  content: string;
  /** Only the promoted user may ever be pinged: `@everyone` in an IGN cannot mention anyone. */
  allowedMentions: { parse: []; users: string[] };
  /** = dedupeKey; lets the receiver dedupe (delivery is at-least-once). */
  idempotencyKey: string;
};

export type SendResult =
  | { ok: true }
  | { ok: false; kind: 'retry'; code: string; message: string; retryAfterMs?: number }
  | { ok: false; kind: 'dead'; code: string; message: string };

export interface NotificationProvider {
  send(msg: OutboundMessage): Promise<SendResult>;
}

/** Payload of `reserve.promoted` (design 8.1): a structured snapshot, no rendered text. */
export type ReservePromotedPayload = {
  occurrenceId: number;
  activityId: string;
  activityName: string;
  date: string;
  startsAt: string;
  roomName: string;
  teamId: number;
  teamName: string;
  slot: number;
  promotedMemberId: string;
  promotedDiscordId: string;
  promotedIgn: string;
  vacatedMemberId: string;
  vacatedIgn: string;
  reason: 'UNREGISTERED' | 'LEAVE' | 'DEACTIVATED';
  planVersion: number;
};

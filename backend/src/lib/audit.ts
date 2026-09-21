import type { Prisma } from '@prisma/client';
import type { Tx } from './tx.js';

export type AuditInput = {
  actorType: 'MEMBER' | 'BOT' | 'SYSTEM';
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  meta?: Prisma.InputJsonValue;
  requestId?: string | null;
};

/** Writes an audit row inside the caller's transaction. `at` uses the DB default clock_timestamp(). */
export async function record(tx: Tx, e: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorType: e.actorType,
      actorId: e.actorId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      meta: e.meta,
      requestId: e.requestId ?? null,
    },
  });
}

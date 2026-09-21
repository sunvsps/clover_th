import type { PrismaClient } from '@prisma/client';

/**
 * Deletes sessions that can never be valid again: past their sliding expiry, or older than the absolute lifetime
 * (security review M-5). Time comparisons are DB-side. Returns how many rows were removed.
 */
export async function purgeExpiredSessions(prisma: PrismaClient, absoluteDays: number): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "Session"
    WHERE "expiresAt" <= clock_timestamp()
       OR "createdAt" + make_interval(days => ${absoluteDays}::int) <= clock_timestamp()`;
}

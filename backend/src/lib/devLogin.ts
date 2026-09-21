import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal', 'db']);

export class DevLoginRefused extends Error {}

/**
 * Break-glass dev login (design 12: Discord OAuth misconfiguration would block all login). It is a SCRIPT only,
 * never an HTTP route. It refuses to run in production, and refuses a non-local database unless explicitly allowed,
 * so a stray DATABASE_URL cannot turn it into a way into a real deployment.
 */
export function assertDevLoginAllowed(env: Record<string, string | undefined>) {
  if (env.NODE_ENV === 'production') {
    throw new DevLoginRefused('dev-login refuses to run when NODE_ENV=production.');
  }
  const url = env.DATABASE_URL;
  if (!url) throw new DevLoginRefused('DATABASE_URL is not set.');
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new DevLoginRefused('DATABASE_URL is not a valid URL.');
  }
  if (!LOCAL_HOSTS.has(host) && env.DEV_LOGIN_ALLOW_REMOTE_DB !== '1') {
    throw new DevLoginRefused(
      `DATABASE_URL points at "${host}", which is not a local database. Set DEV_LOGIN_ALLOW_REMOTE_DB=1 only if you are sure.`,
    );
  }
}

/**
 * Creates a normal DB session for an existing, active member (the same shape the OAuth callback creates: only the
 * sha256 of the token is stored) and returns the cookie value. The token is returned to the caller and never stored
 * or logged; the audit row carries no token.
 */
export async function createDevSession(prisma: PrismaClient, discordId: string, hours = 8) {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new DevLoginRefused('--hours must be between 0 and 24.');
  }
  const member = await prisma.member.findUnique({ where: { discordId } });
  if (!member)
    throw new DevLoginRefused(
      `No member with discordId ${discordId}. Register it through the bot endpoint or the seed first.`,
    );
  if (!member.isActive) throw new DevLoginRefused(`Member ${member.ign} is deactivated.`);
  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "Session" (id, "memberId", "expiresAt")
      VALUES (${createHash('sha256').update(token).digest('hex')}, ${member.id}::uuid,
              clock_timestamp() + make_interval(hours => ${Math.ceil(hours)}::int))`;
    await tx.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        action: 'auth.dev_login',
        entityType: 'member',
        entityId: member.id,
        meta: { hours },
      },
    });
  });
  return { token, member: { id: member.id, ign: member.ign, isAdmin: member.isAdmin } };
}

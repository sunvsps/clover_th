import { Prisma } from '@prisma/client';

/**
 * True when a Prisma error is a Postgres unique violation matching any needle (case-insensitive).
 * Prisma does NOT report the index name for expression/partial indexes: P2002 gives the expression
 * as `target` and a raw query gives only `Key (lower(NORMALIZE(ign, NFC)))=(x) already exists`.
 * So callers pass both the index name and a stable fragment of its expression.
 */
export function isUniqueViolation(err: unknown, ...needles: string[]): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002' && err.code !== 'P2010') return false;
  const haystack = `${err.message} ${safeJson(err.meta)}`.toLowerCase();
  if (err.code === 'P2010' && !haystack.includes('23505')) return false;
  return needles.some((n) => haystack.includes(n.toLowerCase()));
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

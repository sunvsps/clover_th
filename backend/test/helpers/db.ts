import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { inject } from 'vitest';

export type TestDb = { url: string; name: string; prisma: PrismaClient; drop: () => Promise<void> };

/** A fresh database for one test file, cloned from the migrated template, using the production pool settings. */
export async function createTestDb(): Promise<TestDb> {
  const adminUrl = inject('adminUrl');
  const name = `cloverth_t_${randomBytes(6).toString('hex')}`;
  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${inject('templateDb')}"`);
  await admin.$disconnect();
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  u.searchParams.set('connection_limit', '25');
  u.searchParams.set('pool_timeout', '10');
  const url = u.toString();
  const prisma = new PrismaClient({ datasourceUrl: url });
  return {
    url,
    name,
    prisma,
    drop: async () => {
      await prisma.$disconnect();
      const a = new PrismaClient({ datasourceUrl: adminUrl });
      await a.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await a.$disconnect();
    },
  };
}

/** Empties every table (keeps the schema). */
export async function truncateAll(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

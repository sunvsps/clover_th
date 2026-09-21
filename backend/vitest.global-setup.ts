import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import type { TestProject } from 'vitest/node';

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://clover:clover@localhost:55432/postgres';

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string;
    adminUrl: string;
  }
}

/**
 * Migrates ONE template database per run; each test file then clones it (CREATE DATABASE ... TEMPLATE),
 * which is much faster than re-running migrations per file.
 */
export default async function setup(project: TestProject) {
  const name = `cloverth_tpl_${process.pid}_${Date.now()}`;
  const admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  url.searchParams.set('connection_limit', '5');
  url.searchParams.set('pool_timeout', '10');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
  project.provide('templateDb', name);
  project.provide('adminUrl', ADMIN_URL);
  return async () => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  };
}

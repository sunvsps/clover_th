// One-time bulk import of the existing ~76 members, as if the bot had registered them.
// Usage: npx tsx scripts/bulk-import-members.ts <members.json> [--dry-run]
// File: JSON array of { "discordId": "...", "ign": "...", "job": "Knight" | "jobId": 2, "nickname"?: "..." }
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { importMembers } from '../src/modules/members/bulkImport.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: bulk-import-members.ts <members.json> [--dry-run]');
  process.exit(1);
}
const rows = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(rows)) {
  console.error('The file must contain a JSON array.');
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  const results = await importMembers(prisma, rows, { dryRun: process.argv.includes('--dry-run') });
  for (const r of results)
    console.log(`${r.outcome.padEnd(9)} ${r.discordId}${r.error ? `  ${r.error}` : ''}`);
  const failed = results.filter((r) => r.outcome === 'failed').length;
  console.log(
    `done: ${results.length} rows, ${failed} failed${process.argv.includes('--dry-run') ? ' (dry run, nothing saved)' : ''}`,
  );
  process.exitCode = failed ? 1 : 0;
} finally {
  await prisma.$disconnect();
}

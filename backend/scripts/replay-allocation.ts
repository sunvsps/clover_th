// Usage: npx tsx scripts/replay-allocation.ts <roundId>     (needs DATABASE_URL)
// Re-runs the pure allocation from the STORED inputs (queue snapshot, items, preferences) and compares it with the
// stored results. Exit code 0 = identical, 1 = mismatch (FR-3.12).
import { PrismaClient } from '@prisma/client';
import { replayAllocation } from '../src/modules/auctions/replay.js';

const roundId = Number(process.argv[2]);
if (!Number.isInteger(roundId) || roundId < 1) {
  console.error('Usage: replay-allocation.ts <roundId>');
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  const r = await replayAllocation(prisma, roundId);
  console.log(
    `round ${r.roundId} (algorithm v${r.algorithmVersion ?? '?'}): ${r.stored.length} stored awards`,
  );
  if (r.matches) console.log('replay matches the stored results');
  else {
    console.log('MISMATCH');
    console.log('stored  :', JSON.stringify(r.stored));
    console.log('replayed:', JSON.stringify(r.expected));
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}

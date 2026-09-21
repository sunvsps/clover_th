// Break-glass DEV login: creates a session for an existing member so the API can be tested (Postman, curl) without a
// Discord application. Refuses to run in production. There is deliberately NO HTTP route for this.
//
// Usage:  npx tsx scripts/dev-login.ts <discordId> [--hours 8]        (needs DATABASE_URL, NODE_ENV not production)
// Output goes to YOUR terminal only. Do not paste it into shared logs, tickets or chats: the cookie is a live login.
import { PrismaClient } from '@prisma/client';
import { DevLoginRefused, assertDevLoginAllowed, createDevSession } from '../src/lib/devLogin.js';

const discordId = process.argv[2];
const hoursIdx = process.argv.indexOf('--hours');
const hours = hoursIdx > -1 ? Number(process.argv[hoursIdx + 1]) : 8;

try {
  assertDevLoginAllowed(process.env);
  if (!discordId || !/^\d{5,25}$/.test(discordId))
    throw new DevLoginRefused('Usage: dev-login.ts <discordId> [--hours 8]');
  const prisma = new PrismaClient();
  try {
    const { token, member } = await createDevSession(prisma, discordId, hours);
    const origin = new URL(process.env.FRONTEND_URL ?? 'http://localhost:5173').origin;
    console.log(`Signed in as ${member.ign}${member.isAdmin ? ' (admin)' : ''} for ${hours} hour(s).\n`);
    console.log('Send these headers on every request:');
    console.log(`  Cookie: session=${token}`);
    console.log('For POST/PUT/PATCH/DELETE also send (CSRF protection):');
    console.log('  X-Requested-With: dev-login');
    console.log(`  Origin: ${origin}        (optional; if present it must equal this)`);
  } finally {
    await prisma.$disconnect();
  }
} catch (err) {
  console.error(err instanceof DevLoginRefused ? `refused: ${err.message}` : err);
  process.exit(1);
}

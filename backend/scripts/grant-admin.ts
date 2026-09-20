// Usage: npx tsx scripts/grant-admin.ts <discordId>   (needs DATABASE_URL)
// There is deliberately no API or UI to grant admin (design 5).
import { PrismaClient } from '@prisma/client';

const discordId = process.argv[2];
if (!discordId || !/^\d{5,25}$/.test(discordId)) {
  console.error('Usage: grant-admin.ts <discordId>');
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  const member = await prisma.member.findUnique({ where: { discordId } });
  if (!member) {
    console.error(`No member with discordId ${discordId}. The bot must register them first.`);
    process.exitCode = 1;
  } else if (member.isAdmin) {
    console.log(`${member.ign} is already an admin.`);
  } else {
    await prisma.$transaction([
      prisma.member.update({ where: { id: member.id }, data: { isAdmin: true } }),
      prisma.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'member.grant_admin',
          entityType: 'member',
          entityId: member.id,
        },
      }),
    ]);
    console.log(`${member.ign} is now an admin.`);
  }
} finally {
  await prisma.$disconnect();
}

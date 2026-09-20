// Usage:
//   npx tsx scripts/hash-bot-key.ts --generate     new random key + digest (give the key to the bot, keep the digest)
//   echo -n "<key>" | npx tsx scripts/hash-bot-key.ts   digest of an existing key (read from stdin, not argv)
// Put the digest(s) in BOT_API_KEYS (comma-separated, at most two, for rotation).
import { randomBytes } from 'node:crypto';
import { hashBotKey } from '../src/lib/botKey.js';

if (process.argv.includes('--generate')) {
  const key = randomBytes(32).toString('base64url');
  console.log(`bot key (give to the bot, shown once): ${key}`);
  console.log(`BOT_API_KEYS digest: ${hashBotKey(key)}`);
} else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const key = input.replace(/\r?\n$/, '');
  if (!key) {
    console.error('No key on stdin. Use --generate to create one.');
    process.exit(1);
  }
  console.log(hashBotKey(key));
}

import { createHash, timingSafeEqual } from 'node:crypto';

export const hashBotKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');

/** True when the key hashes to any configured digest. Always compares all digests (no early exit). */
export function verifyBotKey(key: string, digests: string[]): boolean {
  const got = createHash('sha256').update(key, 'utf8').digest();
  let ok = false;
  for (const d of digests) {
    const want = Buffer.from(d, 'hex');
    if (want.length === got.length && timingSafeEqual(got, want)) ok = true;
  }
  return ok;
}

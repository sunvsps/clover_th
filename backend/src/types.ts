import type { PrismaClient } from '@prisma/client';
import type { Env } from './config/env.js';
import type { TxRunner } from './lib/tx.js';

export type AuthContext = {
  sessionId: string;
  memberId: string;
  discordId: string;
  ign: string;
  nickname: string | null;
  isAdmin: boolean;
  source: 'BOT' | 'MANUAL';
  job: { id: number; label: string; color: string };
};

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    tx: TxRunner;
    env: Env;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

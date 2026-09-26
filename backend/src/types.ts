import type { PrismaClient } from '@prisma/client';
import type { FastifyReply } from 'fastify';
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
  /** UI language picked last ('en' until the member switches it) */
  language: 'en' | 'th';
  job: { id: number; label: string; color: string };
};

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    tx: TxRunner;
    env: Env;
    /** wrong-bot-key counters per IP, see plugins/botAuth.ts */
    botFailures: Map<string, { count: number; resetAt: number }>;
    /** Set when the built frontend is served (plugins/frontend.ts); null = API only. */
    frontend: { serveIndex: (reply: FastifyReply) => FastifyReply } | null;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

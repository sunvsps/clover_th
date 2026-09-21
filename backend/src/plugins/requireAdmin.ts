import type { FastifyRequest } from 'fastify';
import { errors } from '../lib/errors.js';

/** onRequest guards. They run before body validation so unauthenticated calls never reach it. */
export async function requireAuth(request: FastifyRequest) {
  if (!request.auth) throw errors.authRequired();
}

export async function requireAdmin(request: FastifyRequest) {
  if (!request.auth) throw errors.authRequired();
  if (!request.auth.isAdmin) throw errors.adminRequired();
}

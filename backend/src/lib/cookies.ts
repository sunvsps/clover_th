import type { FastifyRequest } from 'fastify';

/**
 * Whether a cookie set on this response should carry `Secure`. Safari (and other browsers) silently refuse to store
 * a `Secure` cookie on a plain http response, so hardcoding `true` breaks every plain-http origin (local dev on
 * `http://localhost`, or any deployment before TLS is wired up): the browser never persists the cookie, so a later
 * request never sees it back. `req.protocol` reflects `X-Forwarded-Proto` when the app trusts the proxy in front of
 * it (see `trustProxy` in `app.ts`), so a request that really arrived over https still gets `Secure` in production.
 */
export const secureCookie = (req: Pick<FastifyRequest, 'protocol'>) => req.protocol === 'https';

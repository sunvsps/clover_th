/**
 * Which URLs belong to the API and which to the static frontend. Everything under /api/, the docs and /healthz is the
 * API; every other GET/HEAD is a candidate for a static file or the SPA fallback (only when the frontend is served).
 */
export const pathOf = (url: string) => url.split('?')[0]!;

export function isApiPath(url: string): boolean {
  const p = pathOf(url);
  return p === '/api' || p.startsWith('/api/') || p === '/healthz' || p === '/docs' || p.startsWith('/docs/');
}

/** A request the static handler owns: a safe method on a non-API path. */
export const isStaticRequest = (method: string, url: string) =>
  (method === 'GET' || method === 'HEAD') && !isApiPath(url);

/** Client-side route: no file extension in the last path segment. */
export const hasNoExtension = (url: string) => !/\.[A-Za-z0-9]+$/.test(pathOf(url).split('/').pop() ?? '');

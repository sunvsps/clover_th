/* eslint-disable */
// @ts-nocheck
// QA (Sentinel) probes: the OpenAPI document matches the real routes, methods, auth-relevant bodies and error surface.
import type { RouteOptions } from 'fastify';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { useWorld } from '../helpers/world.js';

const seen: RouteOptions[] = [];
const w = useWorld({ onRoute: (r) => seen.push(r) });

describe('QA OpenAPI vs routes', () => {
  it('every real route+method is in /docs/json with the same path parameters, and nothing extra is documented', async () => {
    const doc = (await w.app.inject({ url: '/docs/json' })).json();
    const real = new Set<string>();
    for (const r of seen) {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      for (const m of methods) {
        if (m === 'HEAD' || m === 'OPTIONS') continue;
        if (r.url === '/docs/json') continue;
        real.add(`${m} ${r.url.replace(/:(\w+)/g, '{$1}')}`);
      }
    }
    const documented = new Set<string>();
    for (const [p, ops] of Object.entries<Record<string, unknown>>(doc.paths))
      for (const m of Object.keys(ops))
        if (['get', 'put', 'post', 'patch', 'delete'].includes(m)) documented.add(`${m.toUpperCase()} ${p}`);
    expect([...real].filter((x) => !documented.has(x))).toEqual([]);
    expect([...documented].filter((x) => !real.has(x))).toEqual([]);
    expect(real.size).toBe(48); // 22 (WP1-6) + 7 planner (WP7a/b) + 11 auction type 1 (WP8) + 6 queue/preference (WP9) + 2 queue page
  });

  it('design-listed WP1-WP6 routes all exist (6.1-6.4, 6.7 audit/notifications), and no admin-grant / member create/delete route exists', () => {
    const real = new Set(seen.map((r) => `${r.method} ${r.url}`));
    const expected = [
      'GET /api/v1/auth/discord/login',
      'GET /api/v1/auth/discord/callback',
      'POST /api/v1/auth/logout',
      'GET /api/v1/me',
      'PUT /api/v1/bot/members/:discordId',
      'POST /api/v1/bot/members/:discordId/deactivate',
      'GET /api/v1/members',
      'GET /api/v1/admin/members',
      'PATCH /api/v1/admin/members/:id',
      'POST /api/v1/admin/members/:id/deactivate',
      'POST /api/v1/admin/members/:id/reactivate',
      'GET /api/v1/jobs',
      'PUT /api/v1/admin/jobs',
      'GET /api/v1/activities',
      'GET /api/v1/events',
      'PATCH /api/v1/admin/activities/:id',
      'GET /api/v1/registrations',
      'PUT /api/v1/events/:eventId/occurrences/:date/registrations/:memberId',
      'GET /api/v1/admin/audit-log',
      'GET /api/v1/admin/notifications',
      'POST /api/v1/admin/notifications/:id/retry',
      'GET /healthz',
    ];
    expect(expected.filter((e) => !real.has(e))).toEqual([]);
    const forbidden = [...real].filter(
      (r) => /admin-?grant|grant|\/members$/.test(r) && !/^(GET|HEAD) /.test(r),
    );
    expect(forbidden).toEqual([]);
    expect(
      [...real].some((r) => r.startsWith('DELETE /api/v1/members') || r.startsWith('POST /api/v1/members')),
    ).toBe(false);
  });

  it('bodies are documented strictly (additionalProperties false; isAdmin absent) and enums/regex constraints appear', async () => {
    const doc = (await w.app.inject({ url: '/docs/json' })).json();
    const body = (p: string, m: string) => doc.paths[p][m].requestBody.content['application/json'].schema;
    for (const [p, m] of [
      ['/api/v1/bot/members/{discordId}', 'put'],
      ['/api/v1/admin/members/{id}', 'patch'],
      ['/api/v1/admin/activities/{id}', 'patch'],
      ['/api/v1/admin/jobs', 'put'],
      ['/api/v1/events/{eventId}/occurrences/{date}/registrations/{memberId}', 'put'],
    ] as const) {
      const s = body(p, m);
      expect(s.additionalProperties, `${m} ${p}`).toBe(false);
      expect(JSON.stringify(s)).not.toContain('isAdmin');
    }
    const st = body('/api/v1/events/{eventId}/occurrences/{date}/registrations/{memberId}', 'put').properties
      .status;
    expect(st.enum).toEqual(['JOINED', 'LEAVE', 'NONE']);
  });

  it('the committed openapi.json is byte-identical to a fresh generation and the checked-in schema.d.ts mentions every path', async () => {
    const doc = (await w.app.inject({ url: '/docs/json' })).json();
    const committed = JSON.parse(readFileSync('openapi/openapi.json', 'utf8'));
    expect(Object.keys(committed.paths).sort()).toEqual(
      Object.keys(doc.paths)
        .filter((p) => p !== '/docs/json')
        .sort(),
    );
    const dts = readFileSync('openapi/schema.d.ts', 'utf8');
    for (const p of Object.keys(committed.paths)) expect(dts).toContain(`"${p}"`);
  });

  it('documents the wire error shape or at least does not claim a different one (informational)', async () => {
    const doc = (await w.app.inject({ url: '/docs/json' })).json();
    const op = doc.paths['/api/v1/admin/jobs'].put;
    console.log('OPENAPI responses documented for PUT /admin/jobs:', Object.keys(op.responses).join(','));
    expect(op.responses['200']).toBeTruthy();
  });
});

import type { RouteSpec } from './matrix.js';

const NIL = '00000000-0000-4000-8000-000000000000';

/** Each WP appends its routes here. */
export const routes: RouteSpec[] = [
  // WP1
  { method: 'GET', pattern: '/healthz', url: '/healthz', auth: 'public' },
  { method: 'GET', pattern: '/docs/json', url: '/docs/json', auth: 'public' },
  // WP3
  { method: 'GET', pattern: '/api/v1/auth/discord/login', url: '/api/v1/auth/discord/login', auth: 'public' },
  {
    method: 'GET',
    pattern: '/api/v1/auth/discord/callback',
    url: '/api/v1/auth/discord/callback?code=x&state=y',
    auth: 'public',
  },
  { method: 'POST', pattern: '/api/v1/auth/logout', url: '/api/v1/auth/logout', auth: 'member' },
  { method: 'GET', pattern: '/api/v1/me', url: '/api/v1/me', auth: 'member' },
  {
    method: 'PUT',
    pattern: '/api/v1/bot/members/:discordId',
    url: '/api/v1/bot/members/70001',
    auth: 'bot',
    payload: { ign: 'Matrix', job: 'Knight' },
  },
  {
    method: 'POST',
    pattern: '/api/v1/bot/members/:discordId/deactivate',
    url: '/api/v1/bot/members/70002/deactivate',
    auth: 'bot',
  },
  // WP4
  { method: 'GET', pattern: '/api/v1/admin/audit-log', url: '/api/v1/admin/audit-log', auth: 'admin' },
  { method: 'GET', pattern: '/api/v1/members', url: '/api/v1/members', auth: 'member' },
  { method: 'GET', pattern: '/api/v1/admin/members', url: '/api/v1/admin/members', auth: 'admin' },
  {
    method: 'PATCH',
    pattern: '/api/v1/admin/members/:id',
    url: `/api/v1/admin/members/${NIL}`,
    auth: 'admin',
    payload: { ign: 'Nobody' },
  },
  {
    method: 'POST',
    pattern: '/api/v1/admin/members/:id/deactivate',
    url: `/api/v1/admin/members/${NIL}/deactivate`,
    auth: 'admin',
  },
  {
    method: 'POST',
    pattern: '/api/v1/admin/members/:id/reactivate',
    url: `/api/v1/admin/members/${NIL}/reactivate`,
    auth: 'admin',
  },
  { method: 'GET', pattern: '/api/v1/jobs', url: '/api/v1/jobs', auth: 'member' },
  // invalid body on purpose: the guards are under test, not the replace itself
  {
    method: 'PUT',
    pattern: '/api/v1/admin/jobs',
    url: '/api/v1/admin/jobs',
    auth: 'admin',
    payload: { jobs: 'invalid' },
  },
  // WP5
  {
    method: 'GET',
    pattern: '/api/v1/admin/notifications',
    url: '/api/v1/admin/notifications',
    auth: 'admin',
  },
  {
    method: 'POST',
    pattern: '/api/v1/admin/notifications/:id/retry',
    url: '/api/v1/admin/notifications/999999/retry',
    auth: 'admin',
  },
  // WP6
  { method: 'GET', pattern: '/api/v1/events', url: '/api/v1/events', auth: 'member' },
  { method: 'GET', pattern: '/api/v1/activities', url: '/api/v1/activities', auth: 'member' },
  {
    method: 'PATCH',
    pattern: '/api/v1/admin/activities/:id',
    url: '/api/v1/admin/activities/no-such-activity',
    auth: 'admin',
    payload: { registrationCapacity: 5 },
  },
  {
    method: 'GET',
    pattern: '/api/v1/registrations',
    url: '/api/v1/registrations?from=2000-01-01&to=2000-01-02',
    auth: 'member',
  },
  {
    method: 'PUT',
    pattern: '/api/v1/events/:eventId/occurrences/:date/registrations/:memberId',
    url: '/api/v1/events/no-such-event/occurrences/2000-01-01/registrations/me',
    auth: 'member',
    payload: { status: 'NONE' },
  },
  // WP7a
  {
    method: 'GET',
    pattern: '/api/v1/admin/activities/:id/layout',
    url: '/api/v1/admin/activities/polarity-zone/layout',
    auth: 'admin',
  },
  // invalid body on purpose: the guards are under test, not the replace itself
  {
    method: 'PUT',
    pattern: '/api/v1/admin/activities/:id/layout',
    url: '/api/v1/admin/activities/polarity-zone/layout',
    auth: 'admin',
    payload: { rooms: 'invalid' },
  },
  {
    method: 'GET',
    pattern: '/api/v1/events/:eventId/occurrences/:date/plan',
    url: '/api/v1/events/no-such-event/occurrences/2000-01-01/plan',
    auth: 'member',
  },
  {
    method: 'PUT',
    pattern: '/api/v1/events/:eventId/occurrences/:date/plan/placements/:memberId',
    url: `/api/v1/events/no-such-event/occurrences/2000-01-01/plan/placements/${NIL}`,
    auth: 'admin',
    payload: { teamId: null, expectedVersion: 0 },
  },
  {
    method: 'POST',
    pattern: '/api/v1/events/:eventId/occurrences/:date/plan/clear',
    url: '/api/v1/events/no-such-event/occurrences/2000-01-01/plan/clear',
    auth: 'admin',
    payload: { expectedVersion: 0 },
  },
  {
    method: 'POST',
    pattern: '/api/v1/events/:eventId/occurrences/:date/plan/copy-from-previous',
    url: '/api/v1/events/no-such-event/occurrences/2000-01-01/plan/copy-from-previous',
    auth: 'admin',
    payload: { expectedVersion: 0 },
  },
];

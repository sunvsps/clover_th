import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';

const w = useWorld();
const list = async (h: Record<string, string>) =>
  (await w.app.inject({ url: '/api/v1/jobs', headers: h })).json();
const put = (h: Record<string, string>, jobs: object[]) =>
  w.app.inject({ method: 'PUT', url: '/api/v1/admin/jobs', headers: h, payload: { jobs } });

describe('WP4 jobs', () => {
  it('GET /jobs lists jobs with inUse for any member', async () => {
    const me = await w.signIn();
    const jobs = await list(me.h);
    expect(jobs).toHaveLength(8);
    expect(jobs.find((j: { id: number }) => j.id === 2).inUse).toBe(true); // the signed-in member is a Knight
    expect(jobs.find((j: { id: number }) => j.id === 8).inUse).toBe(false);
  });

  it('PUT replaces atomically: update, create, delete in one call', async () => {
    const admin = await w.signIn({ admin: true });
    const cur = await list(admin.h);
    const keep = cur
      .filter((j: { id: number }) => j.id !== 8)
      .map((j: { id: number; label: string; color: string }) => ({
        id: j.id,
        label: j.label,
        color: j.color,
      }));
    keep[0].color = '#111111';
    const r = await put(admin.h, [...keep, { label: 'Bard', color: '#abcdef' }]);
    expect(r.statusCode).toBe(200);
    const after = r.json();
    expect(after.find((j: { id: number }) => j.id === 1).color).toBe('#111111');
    expect(after.some((j: { label: string }) => j.label === 'Paladin')).toBe(false);
    expect(after.find((j: { label: string }) => j.label === 'Bard').id).toBeGreaterThan(8);
  });

  it('deleting an in-use job fails the WHOLE request with JOB_IN_USE and changes nothing', async () => {
    const admin = await w.signIn({ admin: true }); // admin is a Knight (id 2)
    const before = await list(admin.h);
    const without2 = before
      .filter((j: { id: number }) => j.id !== 2)
      .map((j: { id: number; label: string; color: string }) => ({
        id: j.id,
        label: j.label,
        color: j.id === 1 ? '#999999' : j.color,
      }));
    const r = await put(admin.h, [...without2, { label: 'ShouldNotExist', color: '#123456' }]);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'JOB_IN_USE', details: { jobIds: [2] } });
    expect(await list(admin.h)).toEqual(before);
  });

  it('label swap works; duplicate labels give DUPLICATE_JOB_LABEL', async () => {
    const admin = await w.signIn({ admin: true });
    const cur = await list(admin.h);
    const a = cur[0],
      b = cur[1];
    const others = cur.slice(2).map((j: { id: number; label: string; color: string }) => ({
      id: j.id,
      label: j.label,
      color: j.color,
    }));
    const swapped = await put(admin.h, [
      { id: a.id, label: b.label, color: a.color },
      { id: b.id, label: a.label, color: b.color },
      ...others,
    ]);
    expect(swapped.statusCode).toBe(200);
    const dup = await put(admin.h, [
      { id: a.id, label: 'Same', color: '#000000' },
      { label: 'Same', color: '#000000' },
      ...others,
    ]);
    expect(dup.json().error.code).toBe('DUPLICATE_JOB_LABEL');
  });

  it('non-admins cannot replace jobs; bad colour and unknown id are rejected', async () => {
    const me = await w.signIn();
    expect((await put(me.h, [])).json().error.code).toBe('ADMIN_REQUIRED');
    const admin = await w.signIn({ admin: true });
    expect((await put(admin.h, [{ label: 'X', color: 'red' }])).statusCode).toBe(422);
    expect((await put(admin.h, [{ id: 999, label: 'X', color: '#000000' }])).statusCode).toBe(404);
  });
});

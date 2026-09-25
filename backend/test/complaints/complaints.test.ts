import { describe, expect, it } from 'vitest';
import { useWorld } from '../helpers/world.js';

const w = useWorld();

const create = (h: Record<string, string>, title: string, description: string) =>
  w.app.inject({ method: 'POST', url: '/api/v1/complaints', headers: h, payload: { title, description } });
const list = (h: Record<string, string>) => w.app.inject({ method: 'GET', url: '/api/v1/admin/complaints', headers: h });

describe('complaints', () => {
  it('a member files a complaint but cannot list complaints (admin only)', async () => {
    const a = await w.signIn();

    const created = await create(a.h, 'หัวเรื่อง', 'รายละเอียดปัญหา\nบรรทัดสอง');
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.title).toBe('หัวเรื่อง');
    expect(body.description).toBe('รายละเอียดปัญหา\nบรรทัดสอง');
    expect(body.memberId).toBe(a.id);

    expect((await list(a.h)).statusCode).toBe(403);
  });

  it('an admin lists complaints from every member with the filer IGN', async () => {
    const member = await w.signIn({ ign: 'Complainer' });
    const admin = await w.signIn({ admin: true });
    const created = await create(member.h, 'title', 'description');

    const adminList = await list(admin.h);
    expect(adminList.statusCode).toBe(200);
    const row = adminList.json().items.find((c: { id: number }) => c.id === created.json().id);
    expect(row).toMatchObject({ memberId: member.id, memberIgn: 'Complainer', title: 'title', description: 'description' });
  });

  it('rejects an empty title or description', async () => {
    const a = await w.signIn();
    expect((await create(a.h, '', 'description')).statusCode).toBe(422);
    expect((await create(a.h, 'title', '')).statusCode).toBe(422);
  });

  it('requires sign-in to file a complaint, and admin to list them', async () => {
    expect((await w.app.inject({ method: 'POST', url: '/api/v1/complaints', payload: { title: 't', description: 'd' } })).statusCode).toBe(401);
    expect((await w.app.inject({ method: 'GET', url: '/api/v1/admin/complaints' })).statusCode).toBe(401);
  });
});

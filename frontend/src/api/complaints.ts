import { get, post } from "./client";
import type { paths } from "./schema";

type AdminListBody = paths["/api/v1/admin/complaints"]["get"]["responses"][200]["content"]["application/json"];
type CreateBody = paths["/api/v1/complaints"]["post"]["responses"][201]["content"]["application/json"];

export type Complaint = {
  id: number;
  memberId: string;
  title: string;
  description: string;
  createdAt: string;
};

export type AdminComplaint = Complaint & { memberIgn: string };

export async function createComplaint(title: string, description: string): Promise<Complaint> {
  return post<CreateBody>("/api/v1/complaints", { title, description });
}

/** Admin only: the server rejects this for a non-admin. */
export async function getAdminComplaints(signal?: AbortSignal): Promise<AdminComplaint[]> {
  const body = await get<AdminListBody>("/api/v1/admin/complaints", { signal });
  return body.items;
}

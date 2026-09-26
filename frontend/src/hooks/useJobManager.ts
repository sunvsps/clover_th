/** A job in the list sent to PUT /admin/jobs; `id` is set for existing jobs only (a new job has none until the server creates it). */
export type JobDraftEntry = { id?: number; label: string; color: string };

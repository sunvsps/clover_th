import { useState, type FormEvent } from "react";
import type { Job } from "../data/guild";

/** A job in the draft; `id` is set for existing jobs only (a new job has none until the server creates it). */
export type JobDraftEntry = { id?: number; label: string; color: string };

/**
 * Draft state of the "Jobs & card colours" manager. Opening it copies the current jobs into a draft; nothing is
 * applied until `save` succeeds. `onSaveJobs` calls the API and returns an error text (kept in the dialog so the
 * draft survives) or null on success.
 */
export function useJobManager(jobs: Job[], onSaveJobs: (next: JobDraftEntry[]) => Promise<string | null>) {
  const [jobDraft, setJobDraft] = useState<Job[] | null>(null); // open manager = non-null draft
  const [newIds, setNewIds] = useState<Set<number>>(() => new Set()); // draft ids that do not exist on the server yet
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newJobLabel, setNewJobLabel] = useState("");
  const [newJobColor, setNewJobColor] = useState("#6c8cff");

  function open() {
    setJobDraft(jobs.map((job) => ({ ...job })));
    setNewIds(new Set());
    setSaveError(null);
    setNewJobLabel("");
  }

  function close() {
    setJobDraft(null);
  }

  function patchDraft(id: number, patch: Partial<Job>) {
    setJobDraft((draft) => draft && draft.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }

  function removeDraftJob(id: number) {
    setJobDraft((draft) => draft && draft.filter((entry) => entry.id !== id));
  }

  function addDraftJob(event: FormEvent) {
    event.preventDefault();
    const label = newJobLabel.trim();
    if (!label || !jobDraft) return;
    const id = Math.max(0, ...jobDraft.map((job) => job.id)) + 1;
    setJobDraft([...jobDraft, { id, label, color: newJobColor }]);
    setNewIds((ids) => new Set(ids).add(id));
    setNewJobLabel("");
  }

  const draftValid =
    !!jobDraft &&
    jobDraft.every((job) => job.label.trim()) &&
    new Set(jobDraft.map((job) => job.label.trim().toLowerCase())).size === jobDraft.length;

  async function save() {
    if (!jobDraft || !draftValid || saving) return;
    setSaving(true);
    setSaveError(null);
    const error = await onSaveJobs(jobDraft.map((job) => ({ id: newIds.has(job.id) ? undefined : job.id, label: job.label.trim(), color: job.color })));
    setSaving(false);
    if (error) setSaveError(error);
    else setJobDraft(null);
  }

  return {
    jobDraft,
    newJobLabel,
    setNewJobLabel,
    newJobColor,
    setNewJobColor,
    draftValid,
    saveError,
    saving,
    open,
    close,
    patchDraft,
    removeDraftJob,
    addDraftJob,
    save,
  };
}

export type JobManager = ReturnType<typeof useJobManager>;

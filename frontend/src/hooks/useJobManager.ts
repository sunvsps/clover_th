import { useState, type FormEvent } from "react";
import type { Job } from "../data/guild";

/**
 * Draft state of the "Jobs & card colours" manager. Opening it copies the current jobs into a draft; nothing is
 * applied until `save` succeeds (the parent may refuse, for example when a removed job is still in use).
 */
export function useJobManager(jobs: Job[], onSaveJobs: (next: Job[]) => boolean) {
  const [jobDraft, setJobDraft] = useState<Job[] | null>(null); // open manager = non-null draft
  const [newJobLabel, setNewJobLabel] = useState("");
  const [newJobColor, setNewJobColor] = useState("#6c8cff");

  function open() {
    setJobDraft(jobs.map((job) => ({ ...job })));
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
    setNewJobLabel("");
  }

  const draftValid =
    !!jobDraft &&
    jobDraft.every((job) => job.label.trim()) &&
    new Set(jobDraft.map((job) => job.label.trim().toLowerCase())).size === jobDraft.length;

  function save() {
    if (!jobDraft || !draftValid) return;
    if (onSaveJobs(jobDraft.map((job) => ({ ...job, label: job.label.trim() })))) setJobDraft(null);
  }

  return {
    jobDraft,
    newJobLabel,
    setNewJobLabel,
    newJobColor,
    setNewJobColor,
    draftValid,
    open,
    close,
    patchDraft,
    removeDraftJob,
    addDraftJob,
    save,
  };
}

export type JobManager = ReturnType<typeof useJobManager>;

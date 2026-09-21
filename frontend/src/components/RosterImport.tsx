import { useMemo, useState } from "react";
import { AlertTriangle, Check, FileSpreadsheet, Upload, X } from "lucide-react";
import { admin, registrations, type Job } from "../api";
import { jobStyle } from "../data/guild";
import { formatCp, normalizeIgn, parseGuildCsv, useGearScores, type CsvRow } from "../lib/gearScores";
import type { ViewProps } from "../lib/types";

type Props = Pick<ViewProps, "isThai" | "data" | "notify" | "notifyError" | "reloadData"> & {
  onClose: () => void;
  /** When set, matched members are also registered as reserves for this occurrence so they show up as draggable cards right away. */
  occurrence?: { eventId: string; date: string };
};

/** Known in-game class names that map onto an existing job label when no exact label exists. */
const CLASS_ALIASES: Record<string, string[]> = {
  "Lord Knight": ["Knight"],
  "High Wizard": ["Wizard"],
  "Assassin Cross": ["Assassin"],
  "High Priest": ["Priest", "พระ"],
  "Night Walker": ["Gunslinger"],
  อาลิเทีย: ["ดรูอิด", "Alitheia"],
  Sniper: ["ธนู"],
};
const PALETTE = ["#6c8cff", "#ff8a3d", "#22cc99", "#e455a5", "#f2d24b", "#8fd35c", "#5fd0e8", "#c58aff"];

export default function RosterImport({ isThai, data, notify, notifyError, reloadData, onClose, occurrence }: Props) {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [createJobs, setCreateJobs] = useState(true);
  const [updateJobs, setUpdateJobs] = useState(true);
  const [registerReserves, setRegisterReserves] = useState(true);
  const [busy, setBusy] = useState(false);
  const { merge } = useGearScores();

  const membersByIgn = useMemo(() => new Map(data.members.map((member) => [normalizeIgn(member.ign), member])), [data.members]);
  const jobByLabel = (label: string): Job | undefined => {
    const wanted = label.trim().toLowerCase();
    if (!wanted) return undefined;
    return data.jobs.find((job) => job.label.trim().toLowerCase() === wanted) ?? data.jobs.find((job) => (CLASS_ALIASES[label.trim()] ?? []).some((alias) => alias.toLowerCase() === job.label.trim().toLowerCase()));
  };

  const analysis = useMemo(() => {
    const matched = rows.map((row) => {
      const member = membersByIgn.get(normalizeIgn(row.ign));
      const job = jobByLabel(row.className);
      return { row, member, job, jobChanges: !!member && !!job && member.jobId !== job.id, missingJob: !!row.className && !job };
    });
    const missingClasses = [...new Set(matched.filter((entry) => entry.missingJob).map((entry) => entry.row.className.trim()))];
    return {
      matched,
      found: matched.filter((entry) => entry.member),
      notFound: matched.filter((entry) => !entry.member),
      jobChanges: matched.filter((entry) => entry.jobChanges),
      missingClasses,
      withCp: matched.filter((entry) => entry.member && entry.row.cp !== null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, membersByIgn, data.jobs]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseGuildCsv(text);
    setParseError(parsed.error ? (isThai ? "อ่านไฟล์ไม่ได้ ต้องมีคอลัมน์ 'ชื่อผู้เล่น' และ 'คะแนน Gear'" : "Could not read the file — it needs 'ชื่อผู้เล่น' and 'คะแนน Gear' columns.") : null);
    setRows(parsed.rows);
  }

  async function apply() {
    setBusy(true);
    try {
      // 1. Gear scores (client-side store until the API has a field for it).
      const scores: Record<string, ReturnType<typeof Object>> = {};
      const now = new Date().toISOString();
      analysis.withCp.forEach(({ row, member }) => {
        scores[normalizeIgn(member!.ign)] = { cp: row.cp!, level: row.level, className: row.className, updatedAt: now };
      });
      merge(scores as never);

      // 2. Missing jobs -> create via the job list, then re-resolve.
      let jobs = data.jobs;
      if (createJobs && analysis.missingClasses.length) {
        const next = [...jobs.map((job) => ({ id: job.id, label: job.label, color: job.color, sortOrder: job.sortOrder })), ...analysis.missingClasses.map((label, index) => ({ label, color: PALETTE[(jobs.length + index) % PALETTE.length], sortOrder: jobs.length + index }))];
        jobs = await admin.saveJobs({ jobs: next });
      }
      const resolve = (label: string) => {
        const wanted = label.trim().toLowerCase();
        return jobs.find((job) => job.label.trim().toLowerCase() === wanted) ?? jobs.find((job) => (CLASS_ALIASES[label.trim()] ?? []).some((alias) => alias.toLowerCase() === job.label.trim().toLowerCase()));
      };

      // 3. Job changes on matched members.
      let changed = 0;
      if (updateJobs) {
        for (const { row, member } of analysis.found) {
          const job = resolve(row.className);
          if (member && job && member.jobId !== job.id) {
            await admin.patchMember(member.id, { jobId: job.id });
            changed += 1;
          }
        }
      }
      // 4. Register matched members as reserves for the current occurrence so they show up as draggable cards right away.
      let registered = 0;
      if (registerReserves && occurrence) {
        for (const { member } of analysis.found) {
          if (!member) continue;
          await registrations.set(occurrence.eventId, occurrence.date, member.id, "JOINED");
          registered += 1;
        }
      }

      await reloadData();
      notify(
        isThai
          ? `นำเข้าแล้ว: CP ${analysis.withCp.length} คน · เปลี่ยนอาชีพ ${changed} คน${registered ? ` · ลงทะเบียนเป็นตัวสำรอง ${registered} คน` : ""} · ไม่พบในระบบ ${analysis.notFound.length} คน`
          : `Imported: CP for ${analysis.withCp.length}, job changes ${changed}${registered ? `, ${registered} registered as reserves` : ""}, not on roster ${analysis.notFound.length}.`,
      );
      onClose();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="page-modal roster-import" role="dialog" aria-modal="true" aria-labelledby="roster-import-title" onClick={(event) => event.stopPropagation()}>
        <div className="page-modal-header">
          <div>
            <p className="eyebrow">
              <FileSpreadsheet size={11} /> {isThai ? "แอดมิน: นำเข้ารายชื่อ + CP จาก CSV" : "ADMIN: IMPORT ROSTER + CP FROM CSV"}
            </p>
            <h2 id="roster-import-title">{isThai ? "อัปเดตจากไฟล์ส่งออกของเกม" : "Update from the game export"}</h2>
            <small className="event-dialog-status">
              {isThai
                ? "จับคู่ด้วยชื่อผู้เล่น (IGN) · CP = คอลัมน์ 'คะแนน Gear' · คลาสในไฟล์จะอัปเดตอาชีพของสมาชิก คนที่ไม่มีในระบบต้องลงทะเบียนผ่านบอทก่อน"
                : "Matched by IGN · CP = the 'คะแนน Gear' column · the class column updates each member's job. Names not on the roster must be registered through the bot first."}
            </small>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <label className="file-drop">
          <Upload size={16} />
          <span>{fileName || (isThai ? "เลือกไฟล์ .csv (เช่น CLOVER_TH_20260921.csv)" : "Choose a .csv file (e.g. CLOVER_TH_20260921.csv)")}</span>
          <input type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event.target.files?.[0])} />
        </label>
        {parseError && <p className="queue-warning">{parseError}</p>}

        {rows.length > 0 && (
          <>
            <div className="summary-meta">
              <span>
                <Check size={14} /> {isThai ? "พบในระบบ" : "Matched"} <strong>{analysis.found.length}</strong>/{rows.length}
              </span>
              <span>
                {isThai ? "มี CP" : "With CP"} <strong>{analysis.withCp.length}</strong>
              </span>
              <span>
                {isThai ? "อาชีพเปลี่ยน" : "Job changes"} <strong>{analysis.jobChanges.length}</strong>
              </span>
              <span>
                <AlertTriangle size={14} /> {isThai ? "ไม่พบ" : "Not found"} <strong>{analysis.notFound.length}</strong>
              </span>
            </div>
            <div className="import-options">
              <label className="check">
                <input type="checkbox" checked={updateJobs} onChange={(event) => setUpdateJobs(event.target.checked)} /> {isThai ? "อัปเดตอาชีพตามคอลัมน์คลาส" : "Update jobs from the class column"}
              </label>
              {analysis.missingClasses.length > 0 && (
                <label className="check">
                  <input type="checkbox" checked={createJobs} onChange={(event) => setCreateJobs(event.target.checked)} /> {isThai ? "สร้างอาชีพที่ยังไม่มี" : "Create missing jobs"}: {analysis.missingClasses.join(", ")}
                </label>
              )}
              {occurrence && (
                <label className="check">
                  <input type="checkbox" checked={registerReserves} onChange={(event) => setRegisterReserves(event.target.checked)} />
                  {isThai ? "ลงทะเบียนคนที่พบเป็นตัวสำรองของกิจกรรมนี้ (ให้เป็นการ์ดลากจัดทีมได้ทันที)" : "Register matched members as reserves for this occurrence (so they appear as draggable cards)"}
                </label>
              )}
            </div>
            <div className="admin-table-wrap import-table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{isThai ? "ชื่อในไฟล์" : "Name in file"}</th>
                    <th>Lv.</th>
                    <th>{isThai ? "คลาส" : "Class"}</th>
                    <th>CP</th>
                    <th>{isThai ? "ผล" : "Result"}</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.matched.map(({ row, member, job, jobChanges, missingJob }, index) => (
                    <tr key={index} className={member ? "" : "inactive"}>
                      <td>
                        <strong>{row.ign}</strong>
                      </td>
                      <td className="mono">{row.level ?? ""}</td>
                      <td>
                        {job ? (
                          <span className="job-pill" style={jobStyle(job)}>
                            {job.label}
                          </span>
                        ) : (
                          <span className="muted">{row.className || "—"}</span>
                        )}
                      </td>
                      <td className="mono">{row.cp !== null ? formatCp(row.cp) : ""}</td>
                      <td>
                        {!member ? (
                          <em className="tag status-dead">{isThai ? "ไม่พบในระบบ" : "not on roster"}</em>
                        ) : jobChanges && updateJobs ? (
                          <em className="tag status-draft">{isThai ? "เปลี่ยนอาชีพ" : "job change"}</em>
                        ) : missingJob ? (
                          <em className="tag status-draft">{createJobs ? (isThai ? "สร้างอาชีพใหม่" : "new job") : isThai ? "ข้ามอาชีพ" : "job skipped"}</em>
                        ) : (
                          <em className="tag status-closed">OK</em>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="editor-actions">
              <button type="button" className="copy-button" onClick={onClose}>
                <X size={13} /> {isThai ? "ยกเลิก" : "Cancel"}
              </button>
              <button type="button" className="admin-button" disabled={busy || analysis.found.length === 0} onClick={() => void apply()}>
                <Check size={13} /> {busy ? (isThai ? "กำลังนำเข้า…" : "Importing…") : isThai ? `นำเข้า ${analysis.found.length} คน` : `Import ${analysis.found.length} members`}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

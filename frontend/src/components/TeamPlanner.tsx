import { useState, type DragEvent, type FormEvent } from "react";
import { BarChart3, Check, Copy, Eraser, Eye, GripVertical, Palette, Pencil, Plus, Search, Shield, Trash2, UserPlus, Users, X } from "lucide-react";
import { findJob, jobStyle, SUBTEAM_SIZE, SUBTEAMS_PER_TEAM, teamNames, type GuildMember, type Job } from "../data/guild";
import JobChart from "./JobChart";

export type TeamAssignments = Record<string, string>; // member name -> "A-3"

type Props = {
  isThai: boolean;
  isAdmin: boolean;
  jobs: Job[];
  members: GuildMember[];
  assignments: TeamAssignments;
  onAssign: (member: string, slot: string) => void;
  onRemove: (member: string) => void;
  onClear: () => void;
  onAddMember: (name: string, job: number) => boolean;
  onRenameMember: (oldName: string, newName: string) => boolean;
  onSetMemberJob: (name: string, job: number) => void;
  onRemoveMember: (name: string) => void;
  onSaveJobs: (next: Job[]) => boolean;
  onNotice: (message: string) => void;
};

const DRAG_KEY = "text/guild-member";

export default function TeamPlanner({
  isThai,
  isAdmin,
  jobs,
  members,
  assignments,
  onAssign,
  onRemove,
  onClear,
  onAddMember,
  onRenameMember,
  onSetMemberJob,
  onRemoveMember,
  onSaveJobs,
  onNotice,
}: Props) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newJob, setNewJob] = useState(jobs[0]?.id ?? 1);
  const [editing, setEditing] = useState<{ name: string; value: string; job: number } | null>(null);
  const [jobDraft, setJobDraft] = useState<Job[] | null>(null); // open job manager = non-null draft
  const [newJobLabel, setNewJobLabel] = useState("");
  const [newJobColor, setNewJobColor] = useState("#6c8cff");
  const [slotSearch, setSlotSearch] = useState<{ slot: string; query: string } | null>(null);

  const canEdit = isAdmin;
  const byName = new Map(members.map((member) => [member.name, member]));
  const jobOf = (member: GuildMember) => findJob(jobs, member.job);
  const jobLabel = (member: GuildMember) => jobOf(member)?.label ?? "—";
  const query = search.trim().toLowerCase();
  const unassigned = [...members.filter((member) => !assignments[member.name])].sort((a, b) => a.job - b.job);
  const visiblePool = unassigned.filter((member) => member.name.toLowerCase().includes(query));
  const membersIn = (slot: string) => members.filter((member) => assignments[member.name] === slot);
  const assignedCount = Object.keys(assignments).length;

  function place(member: string, slot: string) {
    onAssign(member, slot);
    setPicked(null);
    setHoverSlot(null);
  }

  function startDrag(event: DragEvent<HTMLElement>, member: string) {
    if (!canEdit) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(DRAG_KEY, member);
    event.dataTransfer.effectAllowed = "move";
    setPicked(null);
  }

  function dropOnSlot(event: DragEvent<HTMLElement>, slot: string) {
    event.preventDefault();
    const member = event.dataTransfer.getData(DRAG_KEY);
    if (member && canEdit) place(member, slot);
  }

  function dropOnPool(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const member = event.dataTransfer.getData(DRAG_KEY);
    if (member && canEdit) onRemove(member);
    setHoverSlot(null);
  }

  function tapChip(member: string) {
    if (!canEdit) return;
    setPicked((current) => (current === member ? null : member));
  }

  function tapSlot(slot: string) {
    if (picked && canEdit) place(picked, slot);
  }

  function submitNewMember(event: FormEvent) {
    event.preventDefault();
    if (onAddMember(newName.trim(), newJob)) setNewName("");
  }

  function saveMemberEdit() {
    if (!editing) return;
    const member = byName.get(editing.name);
    const next = editing.value.trim();
    if (member && editing.job !== member.job) onSetMemberJob(editing.name, editing.job);
    if (next && next !== editing.name && !onRenameMember(editing.name, next)) return;
    setEditing(null);
  }

  function openJobManager() {
    setJobDraft(jobs.map((job) => ({ ...job })));
    setNewJobLabel("");
  }

  function patchDraft(id: number, patch: Partial<Job>) {
    setJobDraft((draft) => draft && draft.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }

  function addDraftJob(event: FormEvent) {
    event.preventDefault();
    const label = newJobLabel.trim();
    if (!label || !jobDraft) return;
    const id = Math.max(0, ...jobDraft.map((job) => job.id)) + 1;
    setJobDraft([...jobDraft, { id, label, color: newJobColor }]);
    setNewJobLabel("");
  }

  const draftValid = !!jobDraft && jobDraft.every((job) => job.label.trim()) && new Set(jobDraft.map((job) => job.label.trim().toLowerCase())).size === jobDraft.length;

  function saveJobs() {
    if (!jobDraft || !draftValid) return;
    if (onSaveJobs(jobDraft.map((job) => ({ ...job, label: job.label.trim() })))) setJobDraft(null);
  }

  const slotMatches = (query: string) =>
    query.trim() ? unassigned.filter((member) => member.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6) : [];

  function copyPlan() {
    const lines = [`Clover_TH Team Plan`, ""];
    teamNames.forEach((team) => {
      lines.push(`Team ${team}`);
      for (let index = 1; index <= SUBTEAMS_PER_TEAM; index += 1) {
        const list = membersIn(`${team}-${index}`);
        lines.push(`  ${team}${index}: ${list.map((member) => `${member.name} (${jobLabel(member)})`).join(", ") || "-"}`);
      }
      lines.push("");
    });
    navigator.clipboard?.writeText(lines.join("\n").trim());
    onNotice(isThai ? "คัดลอกรายชื่อทีมแล้ว" : "Team plan copied to clipboard.");
  }

  const chip = (member: GuildMember, inSlot: boolean) => (
    <div
      className={`member-chip ${picked === member.name ? "picked" : ""} ${canEdit ? "editable" : ""}`}
      style={jobStyle(jobOf(member))}
      draggable={canEdit}
      key={member.name}
      onDragStart={(event) => startDrag(event, member.name)}
      onClick={(event) => {
        event.stopPropagation();
        tapChip(member.name);
      }}
      role={canEdit ? "button" : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onKeyDown={(event) => {
        if (canEdit && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          tapChip(member.name);
        }
      }}
      title={`${member.name} · ${jobLabel(member)}`}
    >
      {canEdit && <GripVertical size={12} className="grip" />}
      <span className="chip-name">{member.name}</span>
      {canEdit && (
        <span className="chip-tools">
          <button
            type="button"
            className="chip-tool"
            aria-label={isThai ? "แก้ไขสมาชิก" : "Edit member"}
            title={isThai ? "แก้ไขชื่อ / อาชีพ" : "Edit name / job"}
            onClick={(event) => {
              event.stopPropagation();
              setPicked(null);
              setEditing({ name: member.name, value: member.name, job: member.job });
            }}
          >
            <Pencil size={10} />
          </button>
          {inSlot && (
            <button
              type="button"
              className="chip-tool remove"
              aria-label={isThai ? "นำออกจากทีม" : "Remove from team"}
              title={isThai ? "นำออกจากทีม" : "Remove from team"}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(member.name);
              }}
            >
              <X size={11} />
            </button>
          )}
        </span>
      )}
    </div>
  );

  const renderSubteam = (team: string, index: number) => {
    const slot = `${team}-${index}`;
    const list = membersIn(slot);
    const isFull = list.length >= SUBTEAM_SIZE;
    const canReceive = canEdit && picked !== null && !isFull && assignments[picked] !== slot;
    return (
      <div
        className={`subteam-card ${hoverSlot === slot ? "hover" : ""} ${isFull ? "full" : ""} ${canReceive ? "receivable" : ""}`}
        key={slot}
        onDragOver={(event) => {
          if (!canEdit) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (hoverSlot !== slot) setHoverSlot(slot);
        }}
        onDragLeave={() => setHoverSlot((current) => (current === slot ? null : current))}
        onDrop={(event) => dropOnSlot(event, slot)}
        onClick={() => tapSlot(slot)}
      >
        <div className="subteam-title">
          <strong>
            {team}
            {index}
          </strong>
          <small>
            {list.length}/{SUBTEAM_SIZE}
          </small>
        </div>
        <div className="subteam-slots">
          {Array.from({ length: SUBTEAM_SIZE }, (_, slotIndex) => {
            const member = list[slotIndex];
            return member ? (
              <div className="subteam-slot" key={member.name}>
                {chip(member, true)}
              </div>
            ) : canEdit && slotIndex === list.length ? (
              <div className="subteam-slot search" key={`search-${slotIndex}`} onClick={(event) => event.stopPropagation()}>
                <Search size={11} />
                <input
                  type="search"
                  value={slotSearch?.slot === slot ? slotSearch.query : ""}
                  placeholder={isThai ? "พิมพ์ชื่อเพื่อเพิ่ม..." : "Type a name to add..."}
                  onChange={(event) => setSlotSearch({ slot, query: event.target.value })}
                  onFocus={() => setSlotSearch({ slot, query: slotSearch?.slot === slot ? slotSearch.query : "" })}
                  onBlur={() => window.setTimeout(() => setSlotSearch((current) => (current?.slot === slot ? null : current)), 150)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      const first = slotMatches(slotSearch?.slot === slot ? slotSearch.query : "")[0];
                      if (first) {
                        event.preventDefault();
                        place(first.name, slot);
                        setSlotSearch(null);
                      }
                    }
                    if (event.key === "Escape") setSlotSearch(null);
                  }}
                  aria-label={isThai ? `เพิ่มสมาชิกเข้า ${team}${index}` : `Add member to ${team}${index}`}
                />
                {slotSearch?.slot === slot && slotMatches(slotSearch.query).length > 0 && (
                  <ul className="admin-entry-matches slot-matches">
                    {slotMatches(slotSearch.query).map((member) => (
                      <li key={member.name}>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            place(member.name, slot);
                            setSlotSearch(null);
                          }}
                        >
                          <i className="job-dot" style={jobStyle(jobOf(member))} /> {member.name}
                          <small>{jobLabel(member)}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {slotSearch?.slot === slot && slotSearch.query.trim() && slotMatches(slotSearch.query).length === 0 && (
                  <ul className="admin-entry-matches slot-matches">
                    <li className="no-match">{isThai ? "ไม่พบสมาชิกที่ยังว่าง" : "No unassigned member matches"}</li>
                  </ul>
                )}
              </div>
            ) : (
              <div className="subteam-slot empty" key={`empty-${slotIndex}`}>
                <span>{slotIndex + 1}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <section className={`feature-page team-page ${canEdit ? "" : "view-only"}`}>
      <div className="feature-heading">
        <div>
          <p className="eyebrow">
            <Users size={13} /> GUILD TEAM PLANNER
          </p>
          <h2>{isThai ? "จัดทีมกิลด์" : "Guild team planner"}</h2>
          <p>
            {canEdit
              ? isThai
                ? `ลากการ์ดสมาชิกไปวางในทีมย่อย A1-A${SUBTEAMS_PER_TEAM} หรือ B1-B${SUBTEAMS_PER_TEAM} (ทีมละไม่เกิน ${SUBTEAM_SIZE} คน) บนไอแพด/มือถือให้แตะการ์ดแล้วแตะทีมที่ต้องการ กดไอคอนดินสอเพื่อแก้ชื่อ`
                : `Drag member cards into subteams A1-A${SUBTEAMS_PER_TEAM} or B1-B${SUBTEAMS_PER_TEAM} (max ${SUBTEAM_SIZE} each). On tablets and phones, tap a card then tap a subteam. Use the pencil to rename.`
              : isThai
                ? "แผนการจัดทีมล่าสุดจากแอดมิน สีของการ์ดแสดงอาชีพตามกราฟด้านล่าง"
                : "The latest team plan from the admins. Card colours follow the job chart below."}
          </p>
        </div>
        <div className="team-actions">
          {!canEdit && (
            <span className="view-only-badge">
              <Eye size={13} /> {isThai ? "ดูอย่างเดียว" : "View only"}
            </span>
          )}
          <button type="button" className="copy-button" onClick={copyPlan}>
            <Copy size={14} /> {isThai ? "คัดลอกรายชื่อทีม" : "Copy plan"}
          </button>
          {canEdit && (
            <button type="button" className="copy-button" onClick={openJobManager}>
              <Palette size={14} /> {isThai ? "จัดการอาชีพ" : "Manage jobs"}
            </button>
          )}
          {canEdit && (
            <button type="button" className="copy-button danger" onClick={onClear} disabled={assignedCount === 0}>
              <Eraser size={14} /> {isThai ? "ล้างทั้งหมด" : "Clear all"}
            </button>
          )}
        </div>
      </div>

      <div className="team-overview">
        <div className="chart-card">
          <div className="pool-title">
            <strong>
              <BarChart3 size={14} /> {isThai ? "จำนวนสมาชิกแต่ละอาชีพ" : "Members per job"}
            </strong>
            <span className="chart-card-meta">
              {members.length} {isThai ? "คน" : "members"}
              {canEdit && (
                <button type="button" className="inline-edit-button" onClick={openJobManager}>
                  <Pencil size={11} /> {isThai ? "แก้ชื่อ / สีอาชีพ" : "Edit jobs"}
                </button>
              )}
            </span>
          </div>
          <JobChart jobs={jobs} members={members} assignments={assignments} isThai={isThai} />
        </div>
        {canEdit && (
          <form className="add-member-card" onSubmit={submitNewMember}>
            <p className="eyebrow">
              <Shield size={11} /> {isThai ? "แอดมิน: เพิ่มสมาชิกใหม่" : "ADMIN: ADD NEW MEMBER"}
            </p>
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={isThai ? "ชื่อในเกม" : "In-game name"}
              maxLength={40}
            />
            <div className="job-picker" role="radiogroup" aria-label={isThai ? "เลือกอาชีพ" : "Choose job"}>
              {jobs.map((job) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={newJob === job.id}
                  className={`job-swatch ${newJob === job.id ? "active" : ""}`}
                  style={jobStyle(job)}
                  key={job.id}
                  onClick={() => setNewJob(job.id)}
                  title={job.label}
                >
                  {job.label}
                </button>
              ))}
            </div>
            <div className="add-member-preview">
              <span className="member-chip preview" style={jobStyle(findJob(jobs, newJob))}>
                <span className="chip-name">{newName.trim() || (isThai ? "ตัวอย่างการ์ด" : "Card preview")}</span>
              </span>
              <em>{findJob(jobs, newJob)?.label}</em>
            </div>
            <button type="submit" className="admin-button" disabled={!newName.trim()}>
              <UserPlus size={13} /> {isThai ? "เพิ่มสมาชิก" : "Add member"}
            </button>
          </form>
        )}
      </div>

      {picked && (
        <div className="picked-banner">
          <span className="job-dot" style={jobStyle(findJob(jobs, byName.get(picked)?.job ?? 0))} />
          {isThai
            ? `เลือก ${picked} แล้ว แตะทีมย่อยที่ต้องการวาง${assignments[picked] ? " หรือแตะช่องสมาชิกเพื่อนำออกจากทีม" : ""}`
            : `${picked} selected. Tap a subteam to place${assignments[picked] ? ", or tap the member pool to unassign" : ""}.`}
          <button type="button" onClick={() => setPicked(null)}>
            {isThai ? "ยกเลิก" : "Cancel"}
          </button>
        </div>
      )}

      <div className="team-planner-layout">
        <aside
          className={`member-pool ${hoverSlot === "pool" ? "hover" : ""}`}
          onDragOver={(event) => {
            if (!canEdit) return;
            event.preventDefault();
            if (hoverSlot !== "pool") setHoverSlot("pool");
          }}
          onDragLeave={() => setHoverSlot((current) => (current === "pool" ? null : current))}
          onDrop={dropOnPool}
          onClick={() => {
            if (picked && assignments[picked]) {
              onRemove(picked);
              setPicked(null);
            }
          }}
        >
          <div className="pool-title">
            <strong>{isThai ? "สมาชิกที่ยังไม่มีทีม" : "Unassigned members"}</strong>
            <span>
              {unassigned.length}/{members.length}
            </span>
          </div>
          <label className="team-search pool-search" onClick={(event) => event.stopPropagation()}>
            <Search size={14} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isThai ? "ค้นหาสมาชิกที่ยังไม่มีทีม..." : "Search unassigned members..."}
            />
          </label>
          <div className="pool-chips">{visiblePool.map((member) => chip(member, false))}</div>
          {visiblePool.length === 0 && (
            <p className="empty-search">{query ? (isThai ? "ไม่พบสมาชิก" : "No members found.") : isThai ? "จัดทีมครบทุกคนแล้ว" : "Everyone has a team."}</p>
          )}
        </aside>

        <div className="team-columns">
          {teamNames.map((team) => {
            const total = members.filter((member) => assignments[member.name]?.startsWith(`${team}-`)).length;
            return (
              <div className={`team-column team-${team.toLowerCase()}`} key={team}>
                <h3>
                  Team {team}
                  <small>
                    {total} {isThai ? "คน" : "members"} · {SUBTEAMS_PER_TEAM} {isThai ? "ทีมย่อย" : "subteams"}
                  </small>
                </h3>
                <div className="subteam-grid">{Array.from({ length: SUBTEAMS_PER_TEAM }, (_, index) => renderSubteam(team, index + 1))}</div>
              </div>
            );
          })}
        </div>
      </div>

      {editing && canEdit && (
        <div className="page-modal-backdrop" role="presentation" onClick={() => setEditing(null)}>
          <section className="page-modal member-editor" role="dialog" aria-modal="true" aria-labelledby="member-editor-title" onClick={(event) => event.stopPropagation()}>
            <div className="page-modal-header">
              <div>
                <p className="eyebrow">
                  <Pencil size={11} /> {isThai ? "แก้ไขสมาชิก" : "EDIT MEMBER"}
                </p>
                <h2 id="member-editor-title">{editing.name}</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setEditing(null)} aria-label="Close">
                ×
              </button>
            </div>
            <form
              className="editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                saveMemberEdit();
              }}
            >
              <label>
                <span>{isThai ? "ชื่อในเกม" : "In-game name"}</span>
                <input autoFocus type="text" value={editing.value} maxLength={40} onChange={(event) => setEditing({ ...editing, value: event.target.value })} />
              </label>
              <div>
                <span className="field-label">{isThai ? "อาชีพ / สีการ์ด" : "Job / card colour"}</span>
                <div className="job-picker" role="radiogroup">
                  {jobs.map((job) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={editing.job === job.id}
                      className={`job-swatch ${editing.job === job.id ? "active" : ""}`}
                      style={jobStyle(job)}
                      key={job.id}
                      onClick={() => setEditing({ ...editing, job: job.id })}
                    >
                      {job.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="add-member-preview">
                <span className="member-chip preview" style={jobStyle(findJob(jobs, editing.job))}>
                  <span className="chip-name">{editing.value.trim() || editing.name}</span>
                </span>
                <em>{findJob(jobs, editing.job)?.label}</em>
              </div>
              <div className="editor-actions">
                {byName.get(editing.name)?.custom && (
                  <button
                    type="button"
                    className="copy-button danger"
                    onClick={() => {
                      onRemoveMember(editing.name);
                      setEditing(null);
                    }}
                  >
                    <Trash2 size={13} /> {isThai ? "ลบสมาชิก" : "Delete member"}
                  </button>
                )}
                <button type="button" className="copy-button" onClick={() => setEditing(null)}>
                  {isThai ? "ยกเลิก" : "Cancel"}
                </button>
                <button type="submit" className="admin-button" disabled={!editing.value.trim()}>
                  {isThai ? "บันทึก" : "Save"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {jobDraft && canEdit && (
        <div className="page-modal-backdrop" role="presentation" onClick={() => setJobDraft(null)}>
          <section className="page-modal job-manager" role="dialog" aria-modal="true" aria-labelledby="job-manager-title" onClick={(event) => event.stopPropagation()}>
            <div className="page-modal-header">
              <div>
                <p className="eyebrow">
                  <Palette size={11} /> {isThai ? "แอดมิน: จัดการอาชีพ" : "ADMIN: MANAGE JOBS"}
                </p>
                <h2 id="job-manager-title">{isThai ? "อาชีพและสีการ์ด" : "Jobs & card colours"}</h2>
                <small className="event-dialog-status">
                  {isThai ? "แก้ชื่อหรือสีแล้วกดบันทึก ลบได้เฉพาะอาชีพที่ไม่มีสมาชิกใช้" : "Edit names or colours, then press Save. Only unused jobs can be deleted."}
                </small>
              </div>
              <button type="button" className="modal-close" onClick={() => setJobDraft(null)} aria-label="Close">
                ×
              </button>
            </div>
            <ul className="job-list">
              {jobDraft.map((job) => {
                const used = members.filter((member) => member.job === job.id).length;
                const duplicate = jobDraft.some((other) => other.id !== job.id && other.label.trim().toLowerCase() === job.label.trim().toLowerCase() && job.label.trim());
                return (
                  <li key={job.id} className={duplicate || !job.label.trim() ? "invalid" : ""}>
                    <label className="color-well" style={jobStyle(job)} title={isThai ? "เลือกสี" : "Pick colour"}>
                      <input type="color" value={job.color} onChange={(event) => patchDraft(job.id, { color: event.target.value })} aria-label={`${job.label} colour`} />
                    </label>
                    <input
                      type="text"
                      value={job.label}
                      maxLength={30}
                      placeholder={isThai ? "ชื่ออาชีพ" : "Job name"}
                      onChange={(event) => patchDraft(job.id, { label: event.target.value })}
                      aria-label="Job name"
                    />
                    <span className="job-count">
                      {used} {isThai ? "คน" : ""}
                    </span>
                    <button
                      type="button"
                      className="chip-tool remove"
                      disabled={used > 0}
                      title={used > 0 ? (isThai ? "ยังมีสมาชิกใช้อาชีพนี้" : "Still in use") : isThai ? "ลบอาชีพ" : "Delete job"}
                      aria-label={isThai ? "ลบอาชีพ" : "Delete job"}
                      onClick={() => setJobDraft(jobDraft.filter((entry) => entry.id !== job.id))}
                    >
                      <Trash2 size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <form className="job-add" onSubmit={addDraftJob}>
              <label className="color-well" style={jobStyle({ id: 0, label: "", color: newJobColor })} title={isThai ? "เลือกสี" : "Pick colour"}>
                <input type="color" value={newJobColor} onChange={(event) => setNewJobColor(event.target.value)} aria-label={isThai ? "สีอาชีพใหม่" : "New job colour"} />
              </label>
              <input type="text" value={newJobLabel} maxLength={30} placeholder={isThai ? "ชื่ออาชีพใหม่" : "New job name"} onChange={(event) => setNewJobLabel(event.target.value)} />
              <button type="submit" className="copy-button" disabled={!newJobLabel.trim()}>
                <Plus size={13} /> {isThai ? "เพิ่มในรายการ" : "Add to list"}
              </button>
            </form>
            <div className="editor-actions">
              {!draftValid && <span className="form-error">{isThai ? "ชื่ออาชีพต้องไม่ว่างและไม่ซ้ำกัน" : "Job names must be filled in and unique."}</span>}
              <button type="button" className="copy-button" onClick={() => setJobDraft(null)}>
                {isThai ? "ยกเลิก" : "Cancel"}
              </button>
              <button type="button" className="admin-button" disabled={!draftValid} onClick={saveJobs}>
                <Check size={13} /> {isThai ? "บันทึก" : "Save"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

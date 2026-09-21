import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Activity as ActivityIcon, Bell, Check, Gavel, LayoutGrid, Palette, Pencil, Plus, RefreshCw, ScrollText, Settings, Trash2, UserCog, X } from "lucide-react";
import { admin, auctions, planner, type AdminMember, type ItemCategory, type Job, type Layout, type RoundSummary } from "../api";
import { categoryLabel, findJob, itemCategories, jobStyle } from "../data/guild";
import { formatDateTime } from "../lib/dates";
import { usePolling } from "../hooks/usePolling";
import { memberName, type ViewProps } from "../lib/types";

type Props = Omit<ViewProps, "isAdmin"> & { reloadData: () => Promise<void> };
type Section = "members" | "jobs" | "activities" | "layout" | "rounds" | "notifications" | "audit";

export default function AdminView({ isThai, me, data, reloadData, notify, notifyError }: Props) {
  const [section, setSection] = useState<Section>("members");
  const sections: { id: Section; label: string; icon: ReactNode }[] = [
    { id: "members", label: isThai ? "สมาชิก" : "Members", icon: <UserCog size={14} /> },
    { id: "jobs", label: isThai ? "อาชีพ" : "Jobs", icon: <Palette size={14} /> },
    { id: "activities", label: isThai ? "กิจกรรม" : "Activities", icon: <ActivityIcon size={14} /> },
    { id: "layout", label: isThai ? "ผังทีม" : "Layouts", icon: <LayoutGrid size={14} /> },
    { id: "rounds", label: isThai ? "ประมูล" : "Auctions", icon: <Gavel size={14} /> },
    { id: "notifications", label: isThai ? "การแจ้งเตือน" : "Notifications", icon: <Bell size={14} /> },
    { id: "audit", label: isThai ? "ประวัติระบบ" : "Audit log", icon: <ScrollText size={14} /> },
  ];
  const shared = { isThai, me, data, reloadData, notify, notifyError };
  return (
    <section className="feature-page admin-page">
      <div className="feature-heading">
        <div>
          <p className="eyebrow">
            <Settings size={13} /> ADMIN MENU / CONFIG
          </p>
          <h2>{isThai ? "ตั้งค่าแอดมิน" : "Admin config"}</h2>
          <p>{isThai ? "สมาชิกมาจากบอท Discord เท่านั้น (เพิ่ม/ให้สิทธิ์แอดมินไม่ได้จากหน้านี้) แก้ชื่อ อาชีพ ปิดใช้งาน ตั้งค่ากิจกรรม ผังทีม และจัดการรอบประมูลได้ที่นี่" : "Members come from the Discord bot only (no add or admin-grant here). Edit names and jobs, deactivate, configure activities and layouts, and run auction rounds."}</p>
        </div>
      </div>
      <div className="admin-tabs">
        {sections.map((entry) => (
          <button type="button" key={entry.id} className={section === entry.id ? "active" : ""} onClick={() => setSection(entry.id)}>
            {entry.icon} {entry.label}
          </button>
        ))}
      </div>
      {section === "members" && <MembersSection {...shared} />}
      {section === "jobs" && <JobsSection key={data.jobs.map((job) => `${job.id}:${job.label}:${job.color}`).join("|")} {...shared} />}
      {section === "activities" && <ActivitiesSection {...shared} />}
      {section === "layout" && <LayoutSection {...shared} />}
      {section === "rounds" && <RoundsSection {...shared} />}
      {section === "notifications" && <NotificationsSection {...shared} />}
      {section === "audit" && <AuditSection {...shared} />}
    </section>
  );
}

// ---------- Members ----------
function MembersSection({ isThai, me, data, reloadData, notify, notifyError }: Props) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ id: string; ign: string; nickname: string; jobId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => admin.members({ includeInactive: includeInactive ? "1" : "0", incomplete: incompleteOnly ? "1" : "0" }), [includeInactive, incompleteOnly]);
  const { data: members, refresh } = usePolling(load, 30000, [includeInactive, incompleteOnly]);
  const query = search.trim().toLowerCase();
  const list = (members ?? []).filter((member) => !query || member.ign.toLowerCase().includes(query) || (member.nickname ?? "").toLowerCase().includes(query));

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      notify(message);
      await refresh();
      await reloadData();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }
  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    void run(
      () => admin.patchMember(editing.id, { ign: editing.ign.trim(), nickname: editing.nickname.trim() || null, jobId: editing.jobId }),
      isThai ? "บันทึกสมาชิกแล้ว" : "Member saved.",
    ).then(() => setEditing(null));
  };
  const toggleActive = (member: AdminMember) =>
    run(() => (member.isActive ? admin.deactivateMember(member.id) : admin.reactivateMember(member.id)), member.isActive ? (isThai ? `ปิดใช้งาน ${member.ign} แล้ว` : `${member.ign} deactivated.`) : isThai ? `เปิดใช้งาน ${member.ign} แล้ว` : `${member.ign} reactivated.`);

  return (
    <div className="admin-section">
      <div className="admin-toolbar">
        <label className="team-search">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isThai ? "ค้นหาชื่อ..." : "Search..."} />
        </label>
        <label className="check">
          <input type="checkbox" checked={incompleteOnly} onChange={(event) => setIncompleteOnly(event.target.checked)} /> {isThai ? "เฉพาะโปรไฟล์ไม่ครบ" : "Incomplete only"}
        </label>
        <label className="check">
          <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /> {isThai ? "รวมที่ปิดใช้งาน" : "Include inactive"}
        </label>
        <span className="occurrence-meta">
          {list.length} {isThai ? "คน" : "members"}
        </span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>IGN</th>
              <th>{isThai ? "ชื่อเล่น" : "Nickname"}</th>
              <th>{isThai ? "อาชีพ" : "Job"}</th>
              <th>Discord</th>
              <th>{isThai ? "สถานะ" : "Status"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((member) => (
              <tr key={member.id} className={member.isActive ? "" : "inactive"}>
                <td>
                  <strong>{member.ign}</strong> {member.isAdmin && <em className="tag">ADMIN</em>}
                </td>
                <td>{member.nickname ?? <em className="muted">{isThai ? "— ไม่ครบ" : "— incomplete"}</em>}</td>
                <td>
                  <span className="job-pill" style={jobStyle(findJob(data.jobs, member.jobId))}>
                    {findJob(data.jobs, member.jobId)?.label ?? member.jobId}
                  </span>
                </td>
                <td className="mono">{member.discordId}</td>
                <td>{member.isActive ? (isThai ? "ใช้งาน" : "Active") : isThai ? "ปิดใช้งาน" : "Inactive"}</td>
                <td className="row-actions">
                  <button type="button" className="chip-tool" title={isThai ? "แก้ไข" : "Edit"} onClick={() => setEditing({ id: member.id, ign: member.ign, nickname: member.nickname ?? "", jobId: member.jobId })}>
                    <Pencil size={11} />
                  </button>
                  <button type="button" className="chip-tool remove" disabled={busy || member.id === me.memberId} title={member.isActive ? (isThai ? "ปิดใช้งาน" : "Deactivate") : isThai ? "เปิดใช้งาน" : "Reactivate"} onClick={() => void toggleActive(member)}>
                    {member.isActive ? <Trash2 size={11} /> : <RefreshCw size={11} />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="page-modal-backdrop" role="presentation" onClick={() => setEditing(null)}>
          <section className="page-modal member-editor" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="page-modal-header">
              <div>
                <p className="eyebrow">
                  <Pencil size={11} /> {isThai ? "แก้ไขสมาชิก" : "EDIT MEMBER"}
                </p>
                <h2>{editing.ign}</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setEditing(null)} aria-label="Close">
                ×
              </button>
            </div>
            <form className="editor-form" onSubmit={saveEdit}>
              <label>
                <span>IGN</span>
                <input type="text" value={editing.ign} maxLength={40} onChange={(event) => setEditing({ ...editing, ign: event.target.value })} />
              </label>
              <label>
                <span>{isThai ? "ชื่อเล่น" : "Nickname"}</span>
                <input type="text" value={editing.nickname} maxLength={40} onChange={(event) => setEditing({ ...editing, nickname: event.target.value })} />
              </label>
              <div>
                <span className="field-label">{isThai ? "อาชีพ / สีการ์ด" : "Job / card colour"}</span>
                <div className="job-picker" role="radiogroup">
                  {data.jobs.map((job) => (
                    <button type="button" role="radio" aria-checked={editing.jobId === job.id} className={`job-swatch ${editing.jobId === job.id ? "active" : ""}`} style={jobStyle(job)} key={job.id} onClick={() => setEditing({ ...editing, jobId: job.id })}>
                      {job.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="editor-actions">
                <button type="button" className="copy-button" onClick={() => setEditing(null)}>
                  {isThai ? "ยกเลิก" : "Cancel"}
                </button>
                <button type="submit" className="admin-button" disabled={busy || !editing.ign.trim()}>
                  {isThai ? "บันทึก" : "Save"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

// ---------- Jobs ----------
function JobsSection({ isThai, data, reloadData, notify, notifyError }: Props) {
  const [draft, setDraft] = useState<(Pick<Job, "label" | "color"> & { id?: number; inUse: boolean })[]>(() => data.jobs.map((job) => ({ id: job.id, label: job.label, color: job.color, inUse: job.inUse })));
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#6c8cff");
  const [busy, setBusy] = useState(false);
  const valid = draft.every((job) => job.label.trim()) && new Set(draft.map((job) => job.label.trim().toLowerCase())).size === draft.length;

  async function save() {
    setBusy(true);
    try {
      await admin.saveJobs({ jobs: draft.map((job, index) => ({ id: job.id, label: job.label.trim(), color: job.color, sortOrder: index })) });
      notify(isThai ? "บันทึกรายการอาชีพแล้ว" : "Job list saved.");
      await reloadData();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-section job-manager-inline">
      <p className="occurrence-meta">{isThai ? "แก้ชื่อหรือสีแล้วกดบันทึก ลบได้เฉพาะอาชีพที่ไม่มีสมาชิกใช้" : "Edit names or colours, then Save. Only unused jobs can be deleted."}</p>
      <ul className="job-list">
        {draft.map((job, index) => (
          <li key={job.id ?? `new-${index}`} className={!job.label.trim() ? "invalid" : ""}>
            <label className="color-well" style={jobStyle(job)}>
              <input type="color" value={job.color} onChange={(event) => setDraft(draft.map((entry, i) => (i === index ? { ...entry, color: event.target.value } : entry)))} aria-label="colour" />
            </label>
            <input type="text" value={job.label} maxLength={30} onChange={(event) => setDraft(draft.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)))} aria-label="Job name" />
            <span className="job-count">{job.inUse ? (isThai ? "ใช้อยู่" : "in use") : ""}</span>
            <button type="button" className="chip-tool remove" disabled={job.inUse} title={job.inUse ? (isThai ? "ยังมีสมาชิกใช้อาชีพนี้" : "Still in use") : isThai ? "ลบ" : "Delete"} onClick={() => setDraft(draft.filter((_, i) => i !== index))}>
              <Trash2 size={11} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="job-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newLabel.trim()) return;
          setDraft([...draft, { label: newLabel.trim(), color: newColor, inUse: false }]);
          setNewLabel("");
        }}
      >
        <label className="color-well" style={jobStyle({ color: newColor })}>
          <input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} aria-label="new colour" />
        </label>
        <input type="text" value={newLabel} maxLength={30} placeholder={isThai ? "ชื่ออาชีพใหม่" : "New job name"} onChange={(event) => setNewLabel(event.target.value)} />
        <button type="submit" className="copy-button" disabled={!newLabel.trim()}>
          <Plus size={13} /> {isThai ? "เพิ่มในรายการ" : "Add to list"}
        </button>
      </form>
      <div className="editor-actions">
        {!valid && <span className="form-error">{isThai ? "ชื่ออาชีพต้องไม่ว่างและไม่ซ้ำกัน" : "Job names must be filled in and unique."}</span>}
        <button type="button" className="admin-button" disabled={!valid || busy} onClick={() => void save()}>
          <Check size={13} /> {isThai ? "บันทึก" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---------- Activities ----------
function ActivitiesSection({ isThai, data, reloadData, notify, notifyError }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { capacity: string; channel: string }>>({});
  const draftOf = (id: string) => drafts[id] ?? { capacity: String(data.activities.find((a) => a.id === id)?.registrationCapacity ?? ""), channel: data.activities.find((a) => a.id === id)?.notifyChannelId ?? "" };

  async function save(id: string, patch: Parameters<typeof admin.patchActivity>[1]) {
    setBusy(id);
    try {
      const result = await admin.patchActivity(id, patch);
      notify(result.promoted.length ? (isThai ? `บันทึกแล้ว · เลื่อนจากสำรอง ${result.promoted.length} คน` : `Saved · ${result.promoted.length} promoted from waitlist`) : isThai ? "บันทึกแล้ว" : "Saved.");
      await reloadData();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{isThai ? "กิจกรรม" : "Activity"}</th>
              <th>{isThai ? "รับสูงสุด (ว่าง = ไม่จำกัด)" : "Capacity (blank = unlimited)"}</th>
              <th>{isThai ? "จัดทีม" : "Planner"}</th>
              <th>{isThai ? "เลื่อนสำรองอัตโนมัติ" : "Auto-backfill"}</th>
              <th>{isThai ? "Channel แจ้งเตือน" : "Notify channel id"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.activities.map((activity) => {
              const draft = draftOf(activity.id);
              return (
                <tr key={activity.id}>
                  <td>
                    <strong>{activity.name}</strong>
                    {activity.isGuild && <em className="tag">GUILD</em>}
                  </td>
                  <td>
                    <input className="small-input" type="number" min={0} value={draft.capacity} onChange={(event) => setDrafts({ ...drafts, [activity.id]: { ...draft, capacity: event.target.value } })} />
                  </td>
                  <td>{activity.hasPlanner ? `${isThai ? "มี" : "yes"} · ${activity.layoutCapacity} ${isThai ? "ช่อง" : "slots"}` : "—"}</td>
                  <td>
                    <input type="checkbox" checked={activity.autoBackfill} disabled={!activity.hasPlanner || busy === activity.id} onChange={(event) => void save(activity.id, { autoBackfill: event.target.checked })} />
                  </td>
                  <td>
                    <input className="small-input wide" type="text" value={draft.channel} placeholder="—" onChange={(event) => setDrafts({ ...drafts, [activity.id]: { ...draft, channel: event.target.value } })} />
                  </td>
                  <td className="row-actions">
                    <button type="button" className="admin-button" disabled={busy === activity.id} onClick={() => void save(activity.id, { registrationCapacity: draft.capacity.trim() === "" ? null : Number(draft.capacity), notifyChannelId: draft.channel.trim() || null })}>
                      <Check size={12} /> {isThai ? "บันทึก" : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Layout ----------
function LayoutSection({ isThai, data, reloadData, notify, notifyError }: Props) {
  const plannerActivities = data.activities.filter((activity) => activity.hasPlanner);
  const [activityId, setActivityId] = useState(plannerActivities[0]?.id ?? "");
  const [layout, setLayout] = useState<Layout | null>(null);
  const [draft, setDraft] = useState<{ id?: number; key: string; name: string; teams: { id?: number; name: string; size: number }[] }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activityId) return;
    planner
      .layout(activityId)
      .then((result) => {
        setLayout(result);
        setDraft(result.rooms.map((room) => ({ id: room.id, key: room.key, name: room.name, teams: room.teams.map((team) => ({ id: team.id, name: team.name, size: team.size })) })));
      })
      .catch(notifyError);
  }, [activityId, notifyError]);

  async function save() {
    setBusy(true);
    try {
      const result = await planner.saveLayout(activityId, { rooms: draft });
      setLayout(result);
      setDraft(result.rooms.map((room) => ({ id: room.id, key: room.key, name: room.name, teams: room.teams.map((team) => ({ id: team.id, name: team.name, size: team.size })) })));
      notify(isThai ? "บันทึกผังทีมแล้ว" : "Layout saved.");
      await reloadData();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }
  const updateRoom = (index: number, patch: Partial<(typeof draft)[number]>) => setDraft(draft.map((room, i) => (i === index ? { ...room, ...patch } : room)));

  return (
    <div className="admin-section">
      <div className="admin-toolbar">
        <label>
          <span className="field-label">{isThai ? "กิจกรรม" : "Activity"}</span>
          <select value={activityId} onChange={(event) => setActivityId(event.target.value)}>
            {plannerActivities.map((activity) => (
              <option value={activity.id} key={activity.id}>
                {activity.name}
              </option>
            ))}
          </select>
        </label>
        {layout && (
          <span className="occurrence-meta">
            {draft.reduce((total, room) => total + room.teams.reduce((sum, team) => sum + team.size, 0), 0)} {isThai ? "ช่องรวม" : "slots total"}
          </span>
        )}
      </div>
      <div className="layout-rooms">
        {draft.map((room, roomIndex) => (
          <div className="team-column" key={room.id ?? room.key}>
            <h3>
              <input className="small-input" type="text" value={room.name} onChange={(event) => updateRoom(roomIndex, { name: event.target.value })} aria-label="Room name" />
              <small>
                {room.teams.length} {isThai ? "ทีม" : "teams"} · {room.teams.reduce((sum, team) => sum + team.size, 0)} {isThai ? "ช่อง" : "slots"}
              </small>
              <button type="button" className="chip-tool remove" title={isThai ? "ลบห้อง" : "Remove room"} onClick={() => setDraft(draft.filter((_, i) => i !== roomIndex))}>
                <Trash2 size={11} />
              </button>
            </h3>
            <ul className="layout-teams">
              {room.teams.map((team, teamIndex) => (
                <li key={team.id ?? teamIndex}>
                  <input className="small-input" type="text" value={team.name} onChange={(event) => updateRoom(roomIndex, { teams: room.teams.map((entry, i) => (i === teamIndex ? { ...entry, name: event.target.value } : entry)) })} aria-label="Team name" />
                  <input className="small-input tiny" type="number" min={1} max={20} value={team.size} onChange={(event) => updateRoom(roomIndex, { teams: room.teams.map((entry, i) => (i === teamIndex ? { ...entry, size: Number(event.target.value) || 1 } : entry)) })} aria-label="Team size" />
                  <button type="button" className="chip-tool remove" onClick={() => updateRoom(roomIndex, { teams: room.teams.filter((_, i) => i !== teamIndex) })} aria-label="Remove team">
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="copy-button" onClick={() => updateRoom(roomIndex, { teams: [...room.teams, { name: `Team ${room.teams.length + 1}`, size: 5 }] })}>
              <Plus size={12} /> {isThai ? "เพิ่มทีม" : "Add team"}
            </button>
          </div>
        ))}
      </div>
      <div className="editor-actions">
        <button type="button" className="copy-button" onClick={() => setDraft([...draft, { key: `room-${Date.now()}`, name: isThai ? "ห้องใหม่" : "New room", teams: [{ name: "Team 1", size: 5 }] }])}>
          <Plus size={12} /> {isThai ? "เพิ่มห้อง" : "Add room"}
        </button>
        <button type="button" className="admin-button" disabled={busy || !activityId} onClick={() => void save()}>
          <Check size={13} /> {isThai ? "บันทึกผัง" : "Save layout"}
        </button>
      </div>
    </div>
  );
}

// ---------- Rounds ----------
type RoundRow = RoundSummary["rounds"][number];
function RoundsSection({ isThai, data, notify, notifyError }: Props) {
  const { data: list, refresh } = usePolling(() => auctions.rounds(), 5000, []);
  const rounds = list?.rounds ?? [];
  const [busy, setBusy] = useState<number | null>(null);
  const [form, setForm] = useState<{ type: "LIVE_CLAIM" | "QUEUE_RANKED"; name: string; durationSec: number; winCap: number; items: { name: string; category: ItemCategory; rarity: string }[] }>({ type: "LIVE_CLAIM", name: "", durationSec: 300, winCap: 5, items: [] });
  const [itemDraft, setItemDraft] = useState<{ name: string; category: ItemCategory; rarity: string }>({ name: "", category: "GEAR", rarity: "" });
  const [results, setResults] = useState<Record<number, Awaited<ReturnType<typeof auctions.results>>>>({});

  async function run(id: number | null, action: () => Promise<unknown>, message: string) {
    setBusy(id ?? -1);
    try {
      await action();
      notify(message);
      await refresh();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(null);
    }
  }
  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(null, () => admin.createRound({ type: form.type, name: form.name.trim(), durationSec: form.durationSec, winCap: form.type === "LIVE_CLAIM" ? form.winCap : undefined, items: form.items.map((item) => ({ name: item.name, category: item.category, rarity: item.rarity || null })) }), isThai ? "สร้างรอบ (ร่าง) แล้ว" : "Draft round created.").then(() => setForm({ ...form, name: "", items: [] }));
  };
  const loadResults = (id: number) => auctions.results(id).then((result) => setResults((current) => ({ ...current, [id]: result }))).catch(notifyError);
  const statusLabel = (round: RoundRow) => (round.status === "OPEN" ? (isThai ? "เปิดอยู่" : "Open") : round.status === "CLOSED" ? (isThai ? "ปิดแล้ว" : "Closed") : round.status === "DRAFT" ? (isThai ? "ร่าง" : "Draft") : isThai ? "ยกเลิก" : "Cancelled");
  const queueCategoriesOnly: ItemCategory[] = ["GEAR", "CARD", "RELIC"];

  return (
    <div className="admin-section rounds-section">
      <form className="round-form" onSubmit={create}>
        <p className="eyebrow">
          <Gavel size={11} /> {isThai ? "สร้างรอบใหม่" : "NEW ROUND"}
        </p>
        <div className="offer-fields">
          <label>
            <span>{isThai ? "ประเภท" : "Type"}</span>
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as typeof form.type, items: form.items.filter((item) => event.target.value === "LIVE_CLAIM" || queueCategoriesOnly.includes(item.category)) })}>
              <option value="LIVE_CLAIM">{isThai ? "กดจองสด (ใครก่อนได้ก่อน)" : "Live claim (first click wins)"}</option>
              <option value="QUEUE_RANKED">{isThai ? "จัดสรรตามคิว (Gear/Card/Relic)" : "Queue allocation (Gear/Card/Relic)"}</option>
            </select>
          </label>
          <label className="grow">
            <span>{isThai ? "ชื่อรอบ" : "Round name"}</span>
            <input type="text" value={form.name} maxLength={60} placeholder={isThai ? "เช่น ประมูลหลัง Guild League 24/9" : "e.g. Post Guild League 24/9"} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            <span>{isThai ? "นาที" : "Minutes"}</span>
            <input type="number" min={1} max={120} value={form.durationSec / 60} onChange={(event) => setForm({ ...form, durationSec: Math.max(1, Number(event.target.value)) * 60 })} />
          </label>
          {form.type === "LIVE_CLAIM" && (
            <label>
              <span>{isThai ? "สูงสุด/คน" : "Cap"}</span>
              <input type="number" min={1} max={20} value={form.winCap} onChange={(event) => setForm({ ...form, winCap: Math.max(1, Number(event.target.value)) })} />
            </label>
          )}
        </div>
        <div className="offer-fields item-adder">
          <label className="grow">
            <span>{isThai ? "ไอเท็ม" : "Item"}</span>
            <input type="text" value={itemDraft.name} maxLength={80} placeholder={isThai ? "ชื่อไอเท็ม" : "Item name"} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} />
          </label>
          <label>
            <span>{isThai ? "หมวด" : "Category"}</span>
            <select value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value as ItemCategory })}>
              {(form.type === "LIVE_CLAIM" ? itemCategories : queueCategoriesOnly).map((category) => (
                <option value={category} key={category}>
                  {categoryLabel(category, isThai)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{isThai ? "ระดับ" : "Rarity"}</span>
            <input type="text" value={itemDraft.rarity} maxLength={20} placeholder="—" onChange={(event) => setItemDraft({ ...itemDraft, rarity: event.target.value })} />
          </label>
          <button
            type="button"
            className="copy-button"
            disabled={!itemDraft.name.trim()}
            onClick={() => {
              setForm({ ...form, items: [...form.items, { ...itemDraft, name: itemDraft.name.trim() }] });
              setItemDraft({ ...itemDraft, name: "" });
            }}
          >
            <Plus size={12} /> {isThai ? "เพิ่มไอเท็ม" : "Add item"}
          </button>
        </div>
        {form.items.length > 0 && (
          <ul className="item-list">
            {form.items.map((item, index) => (
              <li key={index}>
                <span className="cat-pill">{categoryLabel(item.category, isThai)}</span> {item.name} {item.rarity && <small>· {item.rarity}</small>}
                <button type="button" className="chip-tool remove" aria-label="Remove" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="editor-actions">
          <button type="submit" className="admin-button" disabled={!form.name.trim() || form.items.length === 0 || busy !== null}>
            <Plus size={13} /> {isThai ? "สร้างรอบ (ร่าง)" : "Create draft round"}
          </button>
        </div>
      </form>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{isThai ? "ชื่อ" : "Name"}</th>
              <th>{isThai ? "ประเภท" : "Type"}</th>
              <th>{isThai ? "ไอเท็ม" : "Items"}</th>
              <th>{isThai ? "สถานะ" : "Status"}</th>
              <th>{isThai ? "เวลา" : "Window"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rounds.map((round) => (
              <tr key={round.id}>
                <td className="mono">{round.id}</td>
                <td>
                  <strong>{round.name}</strong>
                </td>
                <td>{round.type === "LIVE_CLAIM" ? (isThai ? "กดจองสด" : "Live claim") : isThai ? "ตามคิว" : "Queue"}</td>
                <td>{round.itemCount}</td>
                <td>
                  <em className={`tag status-${round.status.toLowerCase()}`}>{statusLabel(round)}</em>
                </td>
                <td className="mono">{round.opensAt ? `${formatDateTime(round.opensAt, isThai)} → ${round.closesAt ? formatDateTime(round.closesAt, isThai) : ""}` : `${round.durationSec / 60} min`}</td>
                <td className="row-actions">
                  {round.status === "DRAFT" && (
                    <>
                      <button type="button" className="admin-button" disabled={busy !== null} onClick={() => void run(round.id, () => admin.startRound(round.id, {}), isThai ? "เริ่มรอบแล้ว (นับถอยหลัง 3 วิ)" : "Round started (3s countdown).")}>
                        {isThai ? "เริ่ม" : "Start"}
                      </button>
                      <button type="button" className="copy-button danger" disabled={busy !== null} onClick={() => void run(round.id, () => admin.cancelRound(round.id), isThai ? "ยกเลิกรอบแล้ว" : "Round cancelled.")}>
                        {isThai ? "ยกเลิก" : "Cancel"}
                      </button>
                    </>
                  )}
                  {round.status === "OPEN" && (
                    <button type="button" className="copy-button danger" disabled={busy !== null} onClick={() => void run(round.id, () => admin.closeRound(round.id), isThai ? "ปิดรอบแล้ว" : "Round closed.")}>
                      {isThai ? "ปิดรอบตอนนี้" : "Close now"}
                    </button>
                  )}
                  {round.status === "CLOSED" && (
                    <button type="button" className="copy-button" onClick={() => void loadResults(round.id)}>
                      {isThai ? "ดูผล" : "Results"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rounds.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-search">
                  {isThai ? "ยังไม่มีรอบ" : "No rounds yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {Object.values(results).map((result) => (
        <div className="results-card" key={result.roundId}>
          <div className="pool-title">
            <strong>
              {isThai ? "ผลรอบ" : "Results of round"} #{result.roundId}
            </strong>
            <span>{result.leftoverRoundId != null ? (isThai ? `ของเหลือถูกสร้างเป็นร่างรอบ #${result.leftoverRoundId}` : `Leftovers drafted as round #${result.leftoverRoundId}`) : isThai ? "ไม่มีของเหลือ" : "No leftovers"}</span>
          </div>
          <ul className="history-list">
            {result.items.map((item) => (
              <li key={item.id} className={item.winner ? "taken" : "no-taker"}>
                <span className="history-item">
                  <strong>{item.name}</strong>
                  <small>{categoryLabel(item.category, isThai)}</small>
                </span>
                <span className="history-member">{item.winner ? memberName(data, item.winner.memberId) : "—"}</span>
                <span className={`history-result ${item.winner ? "taken" : "no-taker"}`}>{item.winner ? (item.winner.queuePos != null ? `#${item.winner.queuePos}` : isThai ? "ได้ของ" : "Won") : isThai ? "ไม่มีผู้ได้" : "No winner"}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------- Notifications ----------
function NotificationsSection({ isThai, data, notify, notifyError }: Props) {
  const { data: page, refresh } = usePolling(() => admin.notifications({ limit: 50 }), 15000, []);
  const retry = (id: number) => admin.retryNotification(id).then(() => { notify(isThai ? "ส่งใหม่แล้ว" : "Queued for retry."); void refresh(); }).catch(notifyError);
  return (
    <div className="admin-section">
      {page && (
        <div className="summary-meta">
          {(["PENDING", "SENDING", "SENT", "DEAD"] as const).map((status) => (
            <span key={status}>
              {status} <strong>{page.counts[status]}</strong>
            </span>
          ))}
        </div>
      )}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{isThai ? "เหตุการณ์" : "Event"}</th>
              <th>{isThai ? "ปลายทาง" : "Target"}</th>
              <th>{isThai ? "สถานะ" : "Status"}</th>
              <th>{isThai ? "ครั้ง" : "Attempts"}</th>
              <th>{isThai ? "ข้อผิดพลาด" : "Error"}</th>
              <th>{isThai ? "สร้างเมื่อ" : "Created"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(page?.items ?? []).map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.id}</td>
                <td>{item.eventType}{item.entityId && data.membersById.has(item.entityId) ? ` · ${memberName(data, item.entityId)}` : ""}</td>
                <td>{item.target}</td>
                <td>
                  <em className={`tag status-${item.status.toLowerCase()}`}>{item.status}</em>
                </td>
                <td>
                  {item.attempts}/{item.maxAttempts}
                </td>
                <td className="mono">{item.lastErrorCode ?? item.lastError ?? ""}</td>
                <td className="mono">{formatDateTime(item.createdAt, isThai)}</td>
                <td className="row-actions">
                  {(item.status === "DEAD" || item.status === "PENDING") && (
                    <button type="button" className="copy-button" onClick={() => void retry(item.id)}>
                      <RefreshCw size={11} /> {isThai ? "ส่งใหม่" : "Retry"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {(page?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="empty-search">
                  {isThai ? "ยังไม่มีการแจ้งเตือน" : "No notifications yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Audit ----------
function AuditSection({ isThai, data }: Props) {
  const { data: page } = usePolling(() => admin.auditLog({ limit: 100 }), 20000, []);
  return (
    <div className="admin-section">
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{isThai ? "เวลา" : "Time"}</th>
              <th>{isThai ? "ผู้กระทำ" : "Actor"}</th>
              <th>{isThai ? "การกระทำ" : "Action"}</th>
              <th>{isThai ? "เป้าหมาย" : "Entity"}</th>
              <th>{isThai ? "รายละเอียด" : "Details"}</th>
            </tr>
          </thead>
          <tbody>
            {(page?.items ?? []).map((row) => (
              <tr key={row.id}>
                <td className="mono">{formatDateTime(row.at, isThai)}</td>
                <td>{row.actorType === "MEMBER" && row.actorId ? memberName(data, row.actorId) : row.actorType}</td>
                <td className="mono">{row.action}</td>
                <td className="mono">
                  {row.entityType} {data.membersById.has(row.entityId) ? memberName(data, row.entityId) : row.entityId}
                </td>
                <td className="mono small">{row.meta ? JSON.stringify(row.meta).slice(0, 120) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

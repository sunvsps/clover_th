import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Copy, CopyPlus, Eraser, Eye, GripVertical, RotateCcw, Search, TriangleAlert, Users, X } from "lucide-react";
import {
  clearPlan,
  copyFromPrevious,
  getPlan,
  isApiError,
  placeMember,
  undoBackfill,
  usePolling,
  type Plan,
  type PlanPlacement,
  type PlanTeam,
  type WireActivity,
} from "../api";
import { addDays, formatDay, startOfWeek, todayKey } from "../lib/bangkok";
import { findJob, jobStyle, weekDayNames, weekDayShort, type GuildMember, type Job, type ScheduleEvent } from "../data/guild";
import JobChartCard from "./JobChartCard";
import { assignmentsOf, backfillText, flagText, planChangeNotices, planToText } from "./plannerModel";

type Props = {
  isThai: boolean;
  isAdmin: boolean;
  jobs: Job[];
  members: GuildMember[];
  events: ScheduleEvent[];
  activities: WireActivity[];
  onNotice: (message: string) => void;
};

const DRAG_KEY = "text/guild-member";
const POLL_MS = 5000;

export default function TeamPlanner({ isThai, isAdmin, jobs, members, events, activities, onNotice }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const plannerActivities = useMemo(() => activities.filter((a) => a.hasPlanner), [activities]);
  const plannerIds = useMemo(() => new Set(plannerActivities.map((a) => a.id)), [plannerActivities]);
  const plannerEvents = useMemo(
    () => events.filter((e) => plannerIds.has(e.activityId)).sort((a, b) => a.name.localeCompare(b.name) || a.day - b.day || a.start.localeCompare(b.start)),
    [events, plannerIds],
  );
  const dayNames = isThai ? weekDayNames.th : weekDayNames.en;
  const dayShort = isThai ? weekDayShort.th : weekDayShort.en;

  // This week's and the next two weeks' occurrences of every planner event, earliest first: the options of the
  // single "Date" picker (day, date and time together), so there is nothing separate to keep in sync.
  const WEEKS_AHEAD = 3;
  const occurrences = useMemo(() => {
    const weekStart = startOfWeek(todayKey());
    const list: { event: ScheduleEvent; dateKey: string }[] = [];
    for (let week = 0; week < WEEKS_AHEAD; week += 1) {
      plannerEvents.forEach((e) => list.push({ event: e, dateKey: addDays(weekStart, week * 7 + e.day) }));
    }
    return list.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.event.start.localeCompare(b.event.start));
  }, [plannerEvents]);
  /** The soonest occurrence today or later, or the most recent past one if the activity has none upcoming. */
  const nextOccurrenceFor = (activityId: string) => {
    const forActivity = occurrences.filter((o) => o.event.activityId === activityId);
    return forActivity.find((o) => o.dateKey >= todayKey()) ?? forActivity[0];
  };
  const defaultOccurrence = occurrences.find((o) => o.dateKey >= todayKey()) ?? occurrences[0];

  const [eventId, setEventId] = useState(() => defaultOccurrence?.event.id ?? "");
  const event = plannerEvents.find((e) => e.id === eventId);
  const [date, setDate] = useState(() => defaultOccurrence?.dateKey ?? todayKey());
  const occurrencesForActivity = event ? occurrences.filter((o) => o.event.activityId === event.activityId) : [];

  const [picked, setPicked] = useState<string | null>(null);
  const [hoverTeam, setHoverTeam] = useState<number | "pool" | null>(null);
  const [search, setSearch] = useState("");
  const [addTo, setAddTo] = useState<{ teamId: number; query: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const ignOf = (id: string) => byId.get(id)?.ign ?? (isThai ? "อดีตสมาชิก" : "Former member");
  const jobOf = (id: string) => findJob(jobs, byId.get(id)?.job ?? -1);

  // The plan is polled every 5 s while this tab is open (and refetched on focus / after every write).
  const polled = usePolling<Plan>((signal) => getPlan(eventId, date, signal), { intervalMs: POLL_MS, key: `${eventId}:${date}`, enabled: Boolean(event) });
  const plan = polled.data && polled.data.eventId === eventId && polled.data.date === date ? polled.data : null;

  // Toast when the poll shows an auto-promotion or another user's change.
  const previous = useRef<Plan | null>(null);
  const ownVersion = useRef(0);
  useEffect(() => {
    if (!plan) return;
    const before = previous.current;
    previous.current = plan;
    if (!before || before.eventId !== plan.eventId || before.date !== plan.date) return;
    for (const message of planChangeNotices(before, plan, ownVersion.current, isThai, ignOf)) onNotice(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  function selectActivity(activityId: string) {
    const next = nextOccurrenceFor(activityId);
    if (!next) return;
    setEventId(next.event.id);
    setDate(next.dateKey);
    setPicked(null);
    setConfirmClear(false);
    ownVersion.current = 0;
  }
  function pickOccurrence(id: string, dateKey: string) {
    setEventId(id);
    setDate(dateKey);
    setPicked(null);
    setConfirmClear(false);
    ownVersion.current = 0;
  }

  /** Runs one admin write with the plan version we last saw; on any failure the plan is refetched. */
  async function run<R>(action: (version: number) => Promise<R>, onOk?: (result: R) => void) {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const result = await action(plan.version);
      const v = (result as { version?: number }).version;
      if (typeof v === "number") ownVersion.current = Math.max(ownVersion.current, v);
      onOk?.(result);
    } catch (err) {
      if (isApiError(err)) {
        // a stale version: say so; the refetch below brings the current plan (the selection stays where it is)
        onNotice(err.userMessage(isThai));
        if (err.code !== "PLAN_VERSION_CONFLICT") setPicked(null);
      } else onNotice(t("Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง"));
    } finally {
      setBusy(false);
      polled.refresh();
    }
  }

  const place = (memberId: string, teamId: number | null, slot?: number) => {
    setHoverTeam(null);
    // the selection is cleared only when the write succeeds, so a stale-version retry is one tap
    void run(
      (v) => placeMember(eventId, date, memberId, { teamId, ...(slot !== undefined ? { slot } : {}) }, v),
      () => setPicked(null),
    );
  };

  const canEdit = isAdmin && Boolean(plan);
  const placedIds = new Set(Object.keys(assignmentsOf(plan)));
  const reserveIds = new Set((plan?.reserves ?? []).map((r) => r.memberId));
  const pool = members
    .filter((m) => !placedIds.has(m.id) && !reserveIds.has(m.id))
    .filter((m) => m.ign.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.job - b.job || a.ign.localeCompare(b.ign));

  function startDrag(e: DragEvent<HTMLElement>, memberId: string) {
    if (!canEdit) return e.preventDefault();
    e.dataTransfer.setData(DRAG_KEY, memberId);
    e.dataTransfer.effectAllowed = "move";
    setPicked(null);
  }
  const dropOn = (e: DragEvent<HTMLElement>, teamId: number | null, slot?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData(DRAG_KEY);
    if (id && canEdit) place(id, teamId, slot);
    setHoverTeam(null);
  };

  const chipName = (memberId: string) => ignOf(memberId);
  const memberChip = (memberId: string, opts: { placement?: PlanPlacement; team?: PlanTeam; reserve?: number }) => {
    const { placement, team } = opts;
    const flag = placement ? flagText(placement.registration, isThai) : null;
    const isBackfill = placement?.source === "autoBackfill";
    return (
      <div
        key={memberId}
        className={`member-chip ${picked === memberId ? "picked" : ""} ${canEdit ? "editable" : ""} ${flag ? "flagged" : ""}`}
        style={jobStyle(jobOf(memberId))}
        draggable={canEdit}
        onDragStart={(e) => startDrag(e, memberId)}
        onDragOver={(e) => {
          if (canEdit && team && placement) e.preventDefault();
        }}
        onDrop={(e) => team && placement && dropOn(e, team.id, placement.slot)}
        onClick={(e) => {
          e.stopPropagation();
          if (!canEdit) return;
          if (picked && picked !== memberId && team && placement) return place(picked, team.id, placement.slot); // swap into this slot
          setPicked((cur) => (cur === memberId ? null : memberId));
        }}
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onKeyDown={(e) => {
          if (canEdit && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setPicked((cur) => (cur === memberId ? null : memberId));
          }
        }}
        title={`${chipName(memberId)} · ${jobOf(memberId)?.label ?? "—"}`}
      >
        {canEdit && <GripVertical size={12} className="grip" />}
        {placement && <span className="chip-slot">{placement.slot}</span>}
        {opts.reserve !== undefined && <span className="chip-slot">#{opts.reserve}</span>}
        <span className="chip-name">{chipName(memberId)}</span>
        {flag && (
          <span className="chip-flag" title={flag}>
            <TriangleAlert size={10} /> {flag}
          </span>
        )}
        {isBackfill && (
          <span className="backfill-badge" title={backfillText(placement!.backfill?.vacatedMemberId ? ignOf(placement!.backfill.vacatedMemberId) : null, isThai)}>
            {backfillText(placement!.backfill?.vacatedMemberId ? ignOf(placement!.backfill.vacatedMemberId) : null, isThai)}
            {canEdit && (
              <button
                type="button"
                className="undo-backfill"
                disabled={busy}
                aria-label={t(`Undo auto-promotion of ${chipName(memberId)}`, `ย้อนการเลื่อนอัตโนมัติของ ${chipName(memberId)}`)}
                onClick={(e) => {
                  e.stopPropagation();
                  void run(
                    (v) => undoBackfill(eventId, date, memberId, v),
                    () => onNotice(t(`${chipName(memberId)} went back to the reserves.`, `${chipName(memberId)} กลับไปอยู่ในรายชื่อสำรองแล้ว`)),
                  );
                }}
              >
                <RotateCcw size={10} /> {t("Undo", "ย้อนกลับ")}
              </button>
            )}
          </span>
        )}
        {canEdit && placement && (
          <button
            type="button"
            className="chip-tool remove"
            aria-label={t(`Remove ${chipName(memberId)} from the team`, `นำ ${chipName(memberId)} ออกจากทีม`)}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              place(memberId, null);
            }}
          >
            <X size={11} />
          </button>
        )}
      </div>
    );
  };

  const addMatches = (query: string) => {
    const q = query.trim().toLowerCase();
    return q ? members.filter((m) => !placedIds.has(m.id) && m.ign.toLowerCase().includes(q)).slice(0, 6) : [];
  };

  const renderTeam = (team: PlanTeam) => {
    const free = team.size - team.placements.length;
    const isFull = free <= 0;
    const canReceive = canEdit && picked !== null && !isFull;
    const sorted = [...team.placements].sort((a, b) => a.slot - b.slot);
    return (
      <div
        key={team.id}
        data-team={team.name}
        className={`subteam-card ${isFull ? "full" : ""} ${hoverTeam === team.id ? "hover" : ""} ${canReceive ? "receivable" : ""} ${team.archived ? "archived" : ""}`}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          if (hoverTeam !== team.id) setHoverTeam(team.id);
        }}
        onDragLeave={() => setHoverTeam((c) => (c === team.id ? null : c))}
        onDrop={(e) => dropOn(e, team.id)}
        onClick={() => picked && canEdit && place(picked, team.id)}
      >
        <div className="subteam-title">
          <strong>{team.name}</strong>
          <small>
            {team.placements.length}/{team.size}
            {team.archived && ` · ${t("removed", "ถูกลบ")}`}
          </small>
        </div>
        <div className="subteam-slots">
          {sorted.map((p) => (
            <div className="subteam-slot" key={p.memberId}>
              {memberChip(p.memberId, { placement: p, team })}
            </div>
          ))}
          {free > 0 &&
            (canEdit && addTo?.teamId === team.id ? (
              <div className="subteam-slot search" onClick={(e) => e.stopPropagation()}>
                <Search size={11} />
                <input
                  autoFocus
                  type="search"
                  value={addTo.query}
                  placeholder={t("Type a name to add...", "พิมพ์ชื่อเพื่อเพิ่ม...")}
                  aria-label={t(`Add member to ${team.name}`, `เพิ่มสมาชิกเข้า ${team.name}`)}
                  onChange={(e) => setAddTo({ teamId: team.id, query: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAddTo(null);
                    if (e.key === "Enter") {
                      const first = addMatches(addTo.query)[0];
                      if (first) place(first.id, team.id);
                      setAddTo(null);
                    }
                  }}
                />
                {addMatches(addTo.query).length > 0 && (
                  <ul className="admin-entry-matches slot-matches">
                    {addMatches(addTo.query).map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => {
                            place(m.id, team.id);
                            setAddTo(null);
                          }}
                        >
                          <i className="job-dot" style={jobStyle(findJob(jobs, m.job))} /> {m.ign}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : canEdit ? (
              <button
                type="button"
                className="subteam-slot empty compact"
                aria-label={t(`Add a member to ${team.name} (${free} free)`, `เพิ่มสมาชิกเข้า ${team.name} (ว่าง ${free})`)}
                onClick={(e) => {
                  e.stopPropagation();
                  setAddTo({ teamId: team.id, query: "" });
                }}
              >
                + {free} {t("free", "ว่าง")}
              </button>
            ) : (
              <div className="subteam-slot empty compact">
                {free} {t("free", "ว่าง")}
              </div>
            ))}
        </div>
      </div>
    );
  };

  function copyText() {
    if (!plan || !event) return;
    const title = `Clover_TH ${event.name} ${dayNames[event.day]} ${formatDay(date, isThai)} ${event.start}`;
    navigator.clipboard?.writeText(planToText(plan, { title, isThai, ignOf, jobOf: (id) => jobOf(id)?.label ?? "—" }));
    onNotice(t("Team plan copied to clipboard.", "คัดลอกรายชื่อทีมแล้ว"));
  }

  const totalPlaced = plan ? plan.rooms.reduce((n, r) => n + r.teams.reduce((m, tm) => m + tm.placements.length, 0), 0) : 0;
  const totalSlots = plan ? plan.rooms.reduce((n, r) => n + r.capacity, 0) : 0;

  return (
    <section className={`feature-page team-page ${isAdmin ? "" : "view-only"}`}>
      <div className="feature-heading">
        <div>
          <p className="eyebrow">
            <Users size={13} /> GUILD TEAM PLANNER
          </p>
          <h2>{t("Guild team planner", "จัดทีมกิลด์")}</h2>
          <p>
            {isAdmin
              ? t(
                  "Drag a member onto a team (or drop on a member to swap). On tablets and phones, tap a member, then tap the team.",
                  "ลากสมาชิกไปวางในทีม (วางบนสมาชิกเพื่อสลับที่) บนไอแพด/มือถือให้แตะสมาชิกแล้วแตะทีมที่ต้องการ",
                )
              : t("The latest team plan from the admins. Card colours follow the job chart below.", "แผนการจัดทีมล่าสุดจากแอดมิน สีของการ์ดแสดงอาชีพตามกราฟด้านล่าง")}
          </p>
        </div>
        <div className="team-actions">
          {!isAdmin && (
            <span className="view-only-badge">
              <Eye size={13} /> {t("View only", "ดูอย่างเดียว")}
            </span>
          )}
          <button type="button" className="copy-button" onClick={copyText} disabled={!plan}>
            <Copy size={14} /> {t("Copy plan", "คัดลอกรายชื่อทีม")}
          </button>
          {isAdmin && (
            <button
              type="button"
              className="copy-button"
              disabled={!plan || busy}
              onClick={() =>
                void run(
                  (v) => copyFromPrevious(eventId, date, v),
                  (r) =>
                    onNotice(
                      t(
                        `Copied ${r.copied} placements from ${r.sourceDate}${r.skipped.length ? ` (${r.skipped.length} skipped)` : ""}.`,
                        `คัดลอก ${r.copied} ตำแหน่งจาก ${r.sourceDate}${r.skipped.length ? ` (ข้าม ${r.skipped.length})` : ""}`,
                      ),
                    ),
                )
              }
            >
              <CopyPlus size={14} /> {t("Copy from last week", "คัดลอกจากสัปดาห์ก่อน")}
            </button>
          )}
          {isAdmin && (
            <button type="button" className="copy-button danger" onClick={() => setConfirmClear(true)} disabled={!plan || busy || totalPlaced === 0}>
              <Eraser size={14} /> {t("Clear all", "ล้างทั้งหมด")}
            </button>
          )}
        </div>
      </div>

      <div className="auction-tabs" role="tablist" aria-label={t("Activity", "กิจกรรม")}>
        {plannerActivities.map((a) => {
          const active = event?.activityId === a.id;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? "active" : ""}
              key={a.id}
              onClick={() => selectActivity(a.id)}
            >
              {a.name}
            </button>
          );
        })}
      </div>

      <div className="plan-toolbar">
        <label>
          <span>{t("Date", "วันที่")}</span>
          <select
            value={`${date}:${eventId}`}
            onChange={(e) => {
              const [dateKey, id] = e.target.value.split(":");
              pickOccurrence(id!, dateKey!);
            }}
            aria-label={t("Date", "วันที่")}
          >
            {occurrencesForActivity.map((o) => (
              <option key={`${o.dateKey}:${o.event.id}`} value={`${o.dateKey}:${o.event.id}`}>
                {dayShort[o.event.day]} {formatDay(o.dateKey, isThai)} · {o.event.start}
                {o.dateKey === todayKey() ? t(" (today)", " (วันนี้)") : ""}
              </option>
            ))}
          </select>
        </label>
        {plan?.autoBackfill && <span className="auto-badge">{t("Auto-backfill on", "เติมช่องอัตโนมัติ")}</span>}
        {plan && (
          <span className="plan-count">
            {totalPlaced}/{totalSlots} {t("placed", "จัดแล้ว")}
          </span>
        )}
      </div>

      {confirmClear && (
        <div className="confirm-banner" role="alertdialog" aria-label={t("Confirm clear", "ยืนยันการล้าง")}>
          {t(`Remove all ${totalPlaced} placements from this plan? Reserves stay registered.`, `นำทั้ง ${totalPlaced} คนออกจากแผนนี้? สำรองยังคงลงทะเบียนอยู่`)}
          <button
            type="button"
            className="copy-button danger"
            onClick={() => {
              setConfirmClear(false);
              void run(
                (v) => clearPlan(eventId, date, v),
                (r) => onNotice(t(`Plan cleared (${r.removed} removed).`, `ล้างแผนแล้ว (${r.removed} คน)`)),
              );
            }}
          >
            {t("Clear plan", "ล้างแผน")}
          </button>
          <button type="button" className="copy-button" onClick={() => setConfirmClear(false)}>
            {t("Cancel", "ยกเลิก")}
          </button>
        </div>
      )}

      {polled.error && (
        <p className="schedule-error" role="alert">
          {polled.error.userMessage(isThai)}
        </p>
      )}

      <div className="team-overview">
        <JobChartCard jobs={jobs} members={members} assignments={assignmentsOf(plan)} isThai={isThai} />
      </div>

      {picked && canEdit && (
        <div className="picked-banner">
          <span className="job-dot" style={jobStyle(jobOf(picked))} />
          {t(`${ignOf(picked)} selected. Tap a team to place, or a member to swap.`, `เลือก ${ignOf(picked)} แล้ว แตะทีมเพื่อวาง หรือแตะสมาชิกเพื่อสลับที่`)}
          <button type="button" onClick={() => setPicked(null)}>
            {t("Cancel", "ยกเลิก")}
          </button>
        </div>
      )}

      {!plan ? (
        <p className="empty-search" role="status">
          {polled.error ? "" : t("Loading the plan…", "กำลังโหลดแผน…")}
        </p>
      ) : (
        <div className="team-planner-layout">
          <aside
            className={`member-pool ${hoverTeam === "pool" ? "hover" : ""}`}
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              if (hoverTeam !== "pool") setHoverTeam("pool");
            }}
            onDragLeave={() => setHoverTeam((c) => (c === "pool" ? null : c))}
            onDrop={(e) => dropOn(e, null)}
            onClick={() => picked && placedIds.has(picked) && place(picked, null)}
          >
            <div className="pool-title">
              <strong>{t("Reserves", "สำรอง")}</strong>
              <span>{plan.reserves.length}</span>
            </div>
            <ol className="reserve-list" aria-label={t("Reserves in registration order", "รายชื่อสำรองตามลำดับลงทะเบียน")}>
              {plan.reserves.map((r) => (
                <li key={r.memberId}>{memberChip(r.memberId, { reserve: r.order })}</li>
              ))}
            </ol>
            {plan.reserves.length === 0 && <p className="empty-search">{t("No reserves.", "ไม่มีสำรอง")}</p>}

            {isAdmin && (
              <>
                <div className="pool-title pool-second">
                  <strong>{t("Other members", "สมาชิกอื่น")}</strong>
                  <span>{pool.length}</span>
                </div>
                <label className="team-search pool-search" onClick={(e) => e.stopPropagation()}>
                  <Search size={14} />
                  <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search members...", "ค้นหาสมาชิก...")} />
                </label>
                <div className="pool-chips">{pool.map((m) => memberChip(m.id, {}))}</div>
              </>
            )}
          </aside>

          <div className="team-columns">
            {plan.rooms.length === 0 && <p className="empty-search">{t("This activity has no teams yet.", "กิจกรรมนี้ยังไม่มีทีม")}</p>}
            {plan.rooms.map((room) => {
              const placed = room.teams.reduce((n, tm) => n + tm.placements.length, 0);
              return (
                <div className="team-column room-block" key={room.id} data-room={room.name}>
                  <h3>
                    {room.name}
                    <small>
                      {placed}/{room.capacity} {t("slots", "ช่อง")} · {room.teams.length} {t("teams", "ทีม")}
                    </small>
                  </h3>
                  <div className="subteam-grid">{room.teams.map(renderTeam)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

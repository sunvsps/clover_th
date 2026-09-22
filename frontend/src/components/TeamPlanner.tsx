import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { BarChart3, Copy, Eraser, Eye, FileSpreadsheet, GripVertical, History, RotateCcw, Search, Users, Users2, X, Zap } from "lucide-react";
import { ApiError, planner, type Plan, type ScheduleEvent } from "../api";
import { findJob, jobStyle } from "../data/guild";
import { addDays, formatDateTime, formatDay, startOfWeek, todayKey, weekDayShort } from "../lib/dates";
import { usePolling } from "../hooks/usePolling";
import { memberName, type ViewProps } from "../lib/types";
import JobChart from "./JobChart";
import RosterImport from "./RosterImport";
import PartyBoard from "./PartyBoard";
import { formatCp, normalizeIgn, useGearScores } from "../lib/gearScores";
import { useParties } from "../lib/parties";

const DRAG_KEY = "text/guild-member";

/** Current time, refreshed on an interval (kept out of render so the render stays pure). */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
type Occurrence = { event: ScheduleEvent; dateKey: string };
type Team = Plan["rooms"][number]["teams"][number];
type Placement = Team["placements"][number];

/** Clusters a room's subteams by their (optional) group name, preserving first-appearance order; ungrouped subteams stay solo. */
function groupTeams(teams: Team[]): { label: string | null; teams: Team[] }[] {
  const groups: { label: string | null; teams: Team[] }[] = [];
  const byLabel = new Map<string, { label: string | null; teams: Team[] }>();
  teams.forEach((team) => {
    if (!team.group) {
      groups.push({ label: null, teams: [team] });
      return;
    }
    let group = byLabel.get(team.group);
    if (!group) {
      group = { label: team.group, teams: [] };
      byLabel.set(team.group, group);
      groups.push(group);
    }
    group.teams.push(team);
  });
  return groups;
}

export default function TeamPlanner({ isThai, isAdmin, data, notify, notifyError, reloadData }: ViewProps) {
  const { scoreOf, store: gearStore } = useGearScores();
  const { partyOf } = useParties();
  const [importOpen, setImportOpen] = useState(false);
  const [partyBoardOpen, setPartyBoardOpen] = useState(false);
  const cpOf = (memberId: string) => {
    const member = data.membersById.get(memberId);
    return member ? scoreOf(member.ign)?.cp ?? null : null;
  };
  const teamCp = (memberIds: string[]) => memberIds.reduce((total, memberId) => total + (cpOf(memberId) ?? 0), 0);
  const cpCoverage = Object.keys(gearStore).length;
  // Same activity set (and names) as the Layout editor in Admin config, so the two stay in sync.
  const plannerActivities = useMemo(() => data.activities.filter((activity) => activity.hasPlanner), [data.activities]);
  const plannerEvents = useMemo(() => {
    const plannerActivityIds = new Set(plannerActivities.map((activity) => activity.id));
    return data.events.filter((event) => plannerActivityIds.has(event.activityId));
  }, [data.events, plannerActivities]);

  // Occurrences of planner events in this week and the next two.
  const occurrences = useMemo<Occurrence[]>(() => {
    const weekStart = startOfWeek(todayKey());
    const list: Occurrence[] = [];
    for (let week = 0; week < 3; week += 1) {
      plannerEvents.forEach((event) => list.push({ event, dateKey: addDays(weekStart, week * 7 + event.dayOfWeek) }));
    }
    return list.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.event.startTime.localeCompare(b.event.startTime));
  }, [plannerEvents]);

  const [selectedActivityId, setSelectedActivityId] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const nextUpcoming = occurrences.find((occurrence) => occurrence.dateKey >= todayKey()) ?? occurrences[0];
  const activeActivityId = selectedActivityId && plannerActivities.some((activity) => activity.id === selectedActivityId) ? selectedActivityId : (nextUpcoming?.event.activityId ?? plannerActivities[0]?.id ?? "");
  const occurrencesForActivity = occurrences.filter((occurrence) => occurrence.event.activityId === activeActivityId);
  const selected = occurrencesForActivity.find((occurrence) => `${occurrence.dateKey}:${occurrence.event.id}` === selectedKey) ?? occurrencesForActivity.find((occurrence) => occurrence.dateKey >= todayKey()) ?? occurrencesForActivity[0];
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastVersion = useRef<number | null>(null);
  const now = useNow(15000);

  const load = selected ? () => planner.plan(selected.event.id, selected.dateKey) : null;
  const { data: plan, error, refresh, setData: setPlan } = usePolling(load, 5000, [selected?.event.id, selected?.dateKey]);

  // Surface auto-backfills that happened while we were looking.
  useEffect(() => {
    if (!plan) return;
    if (lastVersion.current !== null && plan.version > lastVersion.current) {
      const recent = plan.rooms.flatMap((room) => room.teams.flatMap((team) => team.placements.filter((p) => p.source === "AUTO_BACKFILL" && p.backfill && Date.now() - Date.parse(p.backfill.at) < 60000)));
      if (recent.length) notify(isThai ? `ตัวสำรองถูกเลื่อนเข้าทีมอัตโนมัติ: ${recent.map((p) => memberName(data, p.memberId)).join(", ")}` : `Auto-backfilled: ${recent.map((p) => memberName(data, p.memberId)).join(", ")}`);
    }
    lastVersion.current = plan.version;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.version]);

  const canEdit = isAdmin;
  const placedIds = useMemo(() => new Set(plan?.rooms.flatMap((room) => room.teams.flatMap((team) => team.placements.map((p) => p.memberId))) ?? []), [plan]);
  const reserves = plan?.reserves ?? [];
  const query = search.trim().toLowerCase();
  const visibleReserves = reserves.filter((reserve) => memberName(data, reserve.memberId).toLowerCase().includes(query));
  const memberOf = (memberId: string) => data.membersById.get(memberId);
  const jobOf = (memberId: string) => findJob(data.jobs, memberOf(memberId)?.jobId);
  const startsAt = plan?.startsAt ? Date.parse(plan.startsAt) : null;
  const started = startsAt !== null && startsAt <= now;

  const memberIdByIgn = useMemo(() => new Map(data.members.map((member) => [normalizeIgn(member.ign), member.id])), [data.members]);
  const partyOfMember = (memberId: string) => {
    const member = memberOf(memberId);
    return member ? partyOf(member.ign) : undefined;
  };
  /** Unplaced party mates of a member, so dropping/tapping one person on a team can seat the whole party at once. */
  const partyMatesFor = (memberId: string): string[] => {
    const party = partyOfMember(memberId);
    if (!party) return [];
    return party.memberIgns.map((ign) => memberIdByIgn.get(ign)).filter((id): id is string => !!id && id !== memberId && !placedIds.has(id));
  };
  const pickedParty = picked ? partyOfMember(picked) : undefined;

  async function withPlan(action: (version: number) => Promise<unknown>, success?: string) {
    if (!plan || !selected || busy) return;
    setBusy(true);
    try {
      await action(plan.version);
      if (success) notify(success);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PLAN_VERSION_CONFLICT") {
        const current = err.details.plan as Plan | undefined;
        if (current) setPlan(current);
        else await refresh();
      }
      notifyError(err);
    } finally {
      setBusy(false);
      setPicked(null);
      setHoverTarget(null);
    }
  }

  const place = (memberId: string, teamId: number | null, slot?: number) =>
    withPlan((version) => planner.place(selected!.event.id, selected!.dateKey, memberId, { teamId, slot, expectedVersion: version }));

  /**
   * Placing a member who has a regular party seats the whole party in that team in one go, filling whatever
   * room is left (the member goes in the exact slot dropped on, if any; mates fill the other open slots).
   * Placements are sent one at a time with the version returned by the previous call — `place()`/`withPlan()` can't be
   * reused in a loop here because each only refreshes the `plan` state (and its captured version) after a re-render.
   */
  async function placeParty(teamId: number, primaryMemberId: string, preferredSlot?: number) {
    if (!plan || !selected || busy) return;
    const mates = partyMatesFor(primaryMemberId);
    const team = plan.rooms.flatMap((room) => room.teams).find((t) => t.id === teamId);
    const freeSlots = team ? Math.max(1, team.size - team.placements.length) : 1;
    const ids = [primaryMemberId, ...mates].slice(0, freeSlots);
    setBusy(true);
    let version = plan.version;
    let placedCount = 0;
    try {
      for (const [index, id] of ids.entries()) {
        const result = await planner.place(selected.event.id, selected.dateKey, id, { teamId, slot: index === 0 ? preferredSlot : undefined, expectedVersion: version });
        version = result.version;
        placedCount += 1;
      }
      await refresh();
      if (mates.length) {
        const skipped = mates.length - (placedCount - 1);
        notify(
          isThai
            ? `จัดทั้งปาร์ตี้ลงทีมแล้ว ${placedCount} คน${skipped > 0 ? ` (เหลืออีก ${skipped} คน ทีมเต็ม)` : ""}`
            : `Placed ${placedCount} party members${skipped > 0 ? ` (${skipped} left — team full)` : ""}.`,
        );
      }
    } catch (err) {
      await refresh();
      notifyError(err);
    } finally {
      setBusy(false);
      setPicked(null);
      setHoverTarget(null);
    }
  }

  function startDrag(event: DragEvent<HTMLElement>, memberId: string) {
    if (!canEdit) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(DRAG_KEY, memberId);
    event.dataTransfer.effectAllowed = "move";
    setPicked(null);
  }
  const dragOver = (target: string) => (event: DragEvent<HTMLElement>) => {
    if (!canEdit) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (hoverTarget !== target) setHoverTarget(target);
  };
  const dropTo = (teamId: number | null, slot?: number) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const memberId = event.dataTransfer.getData(DRAG_KEY);
    setHoverTarget(null);
    if (!memberId || !canEdit) return;
    if (teamId !== null && partyMatesFor(memberId).length > 0) void placeParty(teamId, memberId, slot);
    else void place(memberId, teamId, slot);
  };
  const tapTarget = (teamId: number | null, slot?: number) => {
    if (!picked || !canEdit) return;
    if (teamId !== null && partyMatesFor(picked).length > 0) void placeParty(teamId, picked, slot);
    else void place(picked, teamId, slot);
  };

  function copyPlan() {
    if (!plan || !selected) return;
    const lines = [`Clover_TH ${selected.event.name} ${formatDay(selected.dateKey, isThai)}`, ""];
    plan.rooms.forEach((room) => {
      lines.push(`[${room.name}]`);
      room.teams.forEach((team) => {
        if (!team.placements.length) return;
        const total = teamCp(team.placements.map((p) => p.memberId));
        lines.push(`  ${team.name}${total ? ` [CP ${formatCp(total)}]` : ""}: ${[...team.placements].sort((a, b) => a.slot - b.slot).map((p) => `${memberName(data, p.memberId)} (${jobOf(p.memberId)?.label ?? "-"}${cpOf(p.memberId) !== null ? `, ${formatCp(cpOf(p.memberId)!)}` : ""})`).join(", ")}`);
      });
      lines.push("");
    });
    if (reserves.length) lines.push(`${isThai ? "ตัวสำรอง" : "Reserves"}: ${reserves.map((reserve, index) => `${index + 1}. ${memberName(data, reserve.memberId)}`).join(", ")}`);
    navigator.clipboard?.writeText(lines.join("\n").trim());
    notify(isThai ? "คัดลอกรายชื่อทีมแล้ว" : "Team plan copied to clipboard.");
  }

  const chip = (memberId: string, placement?: Placement) => {
    const member = memberOf(memberId);
    const withdrawn = placement && placement.regStatus !== "JOINED";
    const party = member ? partyOfMember(memberId) : undefined;
    const isPartyMate = !!pickedParty && picked !== memberId && party?.id === pickedParty.id;
    return (
      <div
        className={`member-chip ${picked === memberId ? "picked" : ""} ${canEdit ? "editable" : ""} ${withdrawn ? "withdrawn" : ""} ${placement?.source === "AUTO_BACKFILL" ? "backfilled" : ""} ${party ? "has-party" : ""} ${isPartyMate ? "party-mate" : ""}`}
        style={{ ...jobStyle(jobOf(memberId)), ...(party ? ({ "--party-color": party.color } as { [key: string]: string }) : {}) }}
        draggable={canEdit && !busy}
        key={memberId}
        onDragStart={(event) => startDrag(event, memberId)}
        onClick={(event) => {
          event.stopPropagation();
          if (canEdit) setPicked((current) => (current === memberId ? null : memberId));
        }}
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
        title={[
          `${member?.ign ?? memberId} · ${jobOf(memberId)?.label ?? "-"}`,
          party ? (isThai ? `ปาร์ตี้: ${party.label}` : `Party: ${party.label}`) : "",
          withdrawn ? (isThai ? `สถานะลงทะเบียน: ${placement.regStatus}` : `Registration: ${placement.regStatus}`) : "",
          placement?.backfill ? (isThai ? `เลื่อนจากสำรองแทน ${placement.backfill.vacatedMemberId ? memberName(data, placement.backfill.vacatedMemberId) : "-"} เมื่อ ${formatDateTime(placement.backfill.at, isThai)}` : `Auto-promoted for ${placement.backfill.vacatedMemberId ? memberName(data, placement.backfill.vacatedMemberId) : "-"} at ${formatDateTime(placement.backfill.at, isThai)}`) : "",
        ]
          .filter(Boolean)
          .join("\n")}
      >
        {canEdit && <GripVertical size={12} className="grip" />}
        <span className="chip-name">{member?.ign ?? memberName(data, memberId)}</span>
        {cpOf(memberId) !== null && <small className="chip-cp">{formatCp(cpOf(memberId)!)}</small>}
        {placement?.source === "AUTO_BACKFILL" && <Zap size={11} className="chip-flag" />}
        {withdrawn && <small className="chip-warn">{placement.regStatus === "LEAVE" ? (isThai ? "ลา" : "left") : placement.regStatus === "WAITLISTED" ? (isThai ? "สำรอง" : "wait") : isThai ? "ไม่ลง" : "none"}</small>}
        {canEdit && placement && (
          <span className="chip-tools">
            {placement.source === "AUTO_BACKFILL" && (
              <button
                type="button"
                className="chip-tool"
                title={isThai ? "ยกเลิกการเลื่อนอัตโนมัติ (กลับไปเป็นสำรอง)" : "Undo auto-backfill"}
                aria-label="Undo backfill"
                onClick={(event) => {
                  event.stopPropagation();
                  void withPlan((version) => planner.undoBackfill(selected!.event.id, selected!.dateKey, memberId, version), isThai ? "ยกเลิกการเลื่อนอัตโนมัติแล้ว" : "Backfill undone.");
                }}
              >
                <RotateCcw size={10} />
              </button>
            )}
            <button
              type="button"
              className="chip-tool remove"
              aria-label={isThai ? "นำออกจากทีม" : "Remove from team"}
              title={isThai ? "นำออกจากทีม (กลับเป็นตัวสำรอง)" : "Remove from team (back to reserves)"}
              onClick={(event) => {
                event.stopPropagation();
                void place(memberId, null);
              }}
            >
              <X size={11} />
            </button>
          </span>
        )}
      </div>
    );
  };

  const subteamCard = (team: Team) => {
    const bySlot = new Map(team.placements.map((p) => [p.slot, p]));
    const isFull = team.placements.length >= team.size;
    const canReceive = canEdit && picked !== null && !team.placements.some((p) => p.memberId === picked);
    return (
      <div
        className={`subteam-card ${hoverTarget === `team-${team.id}` ? "hover" : ""} ${isFull ? "full" : ""} ${canReceive ? "receivable" : ""} ${team.placements.length === 0 ? "empty-team" : ""}`}
        key={team.id}
        onDragOver={dragOver(`team-${team.id}`)}
        onDragLeave={() => setHoverTarget((current) => (current === `team-${team.id}` ? null : current))}
        onDrop={dropTo(team.id)}
        onClick={() => tapTarget(team.id)}
      >
        <div className="subteam-title">
          <strong>{team.name}</strong>
          <small>
            {team.placements.length}/{team.size}
            {team.placements.length > 0 && cpCoverage > 0 && <b className="team-cp"> · CP {formatCp(teamCp(team.placements.map((p) => p.memberId)))}</b>}
          </small>
        </div>
        <div className="subteam-slots">
          {Array.from({ length: team.size }, (_, index) => {
            const slot = index + 1;
            const placement = bySlot.get(slot);
            return placement ? (
              <div className="subteam-slot" key={slot} onDragOver={dragOver(`slot-${team.id}-${slot}`)} onDrop={dropTo(team.id, slot)} onClick={(event) => { event.stopPropagation(); tapTarget(team.id, slot); }}>
                {chip(placement.memberId, placement)}
              </div>
            ) : (
              <div className="subteam-slot empty" key={slot} onDragOver={dragOver(`slot-${team.id}-${slot}`)} onDrop={dropTo(team.id, slot)} onClick={(event) => { event.stopPropagation(); tapTarget(team.id, slot); }}>
                <span>{slot}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const importDialog =
    importOpen && canEdit ? (
      <RosterImport
        isThai={isThai}
        data={data}
        notify={notify}
        notifyError={notifyError}
        reloadData={reloadData}
        onClose={() => setImportOpen(false)}
        occurrence={selected ? { eventId: selected.event.id, date: selected.dateKey } : undefined}
      />
    ) : null;
  const partyDialog = partyBoardOpen && canEdit ? <PartyBoard isThai={isThai} data={data} notify={notify} onClose={() => setPartyBoardOpen(false)} /> : null;

  if (!selected) {
    return (
      <section className="feature-page team-page">
        <p className="empty-search">{isThai ? "ยังไม่มีกิจกรรมที่มีการจัดทีม" : "No planner activities configured."}</p>
      </section>
    );
  }

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
                ? "ลากตัวสำรองไปวางในช่องของทีม (วางทับคนอื่น = สลับที่) หรือแตะการ์ดแล้วแตะช่อง ตัวสำรองคือคนที่ลงทะเบียนเล่นแล้วแต่ยังไม่มีทีม เรียงตามเวลาลงทะเบียน ถ้าคนนั้นมีปาร์ตี้ประจำ วางลงช่องไหนของทีมก็ได้ ระบบจะจัดทั้งปาร์ตี้ลงทีมเดียวกันให้เอง"
                : "Drag a reserve onto a team slot (dropping on someone swaps them), or tap a card then tap a slot. Reserves are members registered as playing but not yet placed, in registration order. If that member has a regular party, dropping them on any slot in a team seats the whole party there."
              : isThai
                ? "แผนการจัดทีมล่าสุดจากแอดมิน ลงทะเบียนเล่นในตารางกิจกรรมเพื่อเข้าเป็นตัวสำรอง"
                : "The latest team plan from the admins. Register as playing on the schedule to join the reserves."}
          </p>
        </div>
        <div className="team-actions">
          {!canEdit && (
            <span className="view-only-badge">
              <Eye size={13} /> {isThai ? "ดูอย่างเดียว" : "View only"}
            </span>
          )}
          <button type="button" className="copy-button" onClick={copyPlan} disabled={!plan}>
            <Copy size={14} /> {isThai ? "คัดลอกรายชื่อทีม" : "Copy plan"}
          </button>
          {canEdit && (
            <>
              <button type="button" className="copy-button" onClick={() => setImportOpen(true)}>
                <FileSpreadsheet size={14} /> {isThai ? "นำเข้า CSV (รายชื่อ + CP)" : "Import CSV (roster + CP)"}
              </button>
              <button type="button" className="copy-button" onClick={() => setPartyBoardOpen(true)}>
                <Users2 size={14} /> {isThai ? "ปาร์ตี้ประจำ" : "Regular parties"}
              </button>
              <button
                type="button"
                className="copy-button"
                disabled={!plan || busy || placedIds.size > 0}
                title={placedIds.size > 0 ? (isThai ? "ต้องล้างแผนก่อนถึงจะคัดลอกได้" : "Clear the plan first") : undefined}
                onClick={() => void withPlan((version) => planner.copyFromPrevious(selected.event.id, selected.dateKey, version), isThai ? "คัดลอกแผนจากสัปดาห์ก่อนแล้ว" : "Copied last week's plan.")}
              >
                <History size={14} /> {isThai ? "คัดลอกจากสัปดาห์ก่อน" : "Copy from previous week"}
              </button>
              <button
                type="button"
                className="copy-button danger"
                disabled={!plan || busy || placedIds.size === 0}
                onClick={() => {
                  if (window.confirm(isThai ? "ล้างการจัดทีมทั้งหมดของรอบนี้?" : "Clear every placement for this occurrence?")) void withPlan((version) => planner.clear(selected.event.id, selected.dateKey, version), isThai ? "ล้างแผนแล้ว" : "Plan cleared.");
                }}
              >
                <Eraser size={14} /> {isThai ? "ล้างทั้งหมด" : "Clear all"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="activity-tabs" role="tablist" aria-label={isThai ? "กิจกรรม" : "Activity"}>
        {plannerActivities.map((activity) => (
          <button
            type="button"
            role="tab"
            aria-selected={activity.id === activeActivityId}
            className={activity.id === activeActivityId ? "active" : ""}
            key={activity.id}
            onClick={() => {
              setSelectedActivityId(activity.id);
              setSelectedKey("");
            }}
          >
            {activity.name}
          </button>
        ))}
      </div>

      <div className="occurrence-picker">
        {occurrencesForActivity.length > 1 ? (
          <label>
            <span>{isThai ? "วันที่" : "Date"}</span>
            <select value={selected ? `${selected.dateKey}:${selected.event.id}` : ""} onChange={(event) => setSelectedKey(event.target.value)}>
              {occurrencesForActivity.map((occurrence) => (
                <option value={`${occurrence.dateKey}:${occurrence.event.id}`} key={`${occurrence.dateKey}:${occurrence.event.id}`}>
                  {(isThai ? weekDayShort.th : weekDayShort.en)[occurrence.event.dayOfWeek]} {formatDay(occurrence.dateKey, isThai)} · {occurrence.event.startTime}
                  {occurrence.dateKey === todayKey() ? (isThai ? " (วันนี้)" : " (today)") : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          selected && (
            <span className="occurrence-meta solo-date">
              {(isThai ? weekDayShort.th : weekDayShort.en)[selected.event.dayOfWeek]} {formatDay(selected.dateKey, isThai)} · {selected.event.startTime}
              {selected.dateKey === todayKey() ? (isThai ? " (วันนี้)" : " (today)") : ""}
            </span>
          )
        )}
        {plan && (
          <span className="occurrence-meta">
            {isThai ? "เวอร์ชัน" : "version"} {plan.version} · {placedIds.size} {isThai ? "คนในทีม" : "placed"} · {reserves.length} {isThai ? "ตัวสำรอง" : "reserves"}
            {plan.autoBackfill && (
              <em>
                <Zap size={10} /> {isThai ? "เลื่อนสำรองอัตโนมัติ" : "auto-backfill"}
              </em>
            )}
            {started && <em className="warn">{isThai ? "กิจกรรมเริ่มแล้ว" : "started"}</em>}
            {cpCoverage > 0 && <em title={isThai ? "CP มาจากไฟล์ CSV ที่นำเข้าในเบราว์เซอร์นี้" : "CP comes from the CSV imported in this browser"}>CP {cpCoverage} {isThai ? "คน" : "members"}</em>}
          </span>
        )}
      </div>

      {error != null && <p className="queue-warning">{String((error as Error).message ?? error)}</p>}

      {plan && (
        <>
          <div className="team-overview">
            <div className="chart-card">
              <div className="pool-title">
                <strong>
                  <BarChart3 size={14} /> {isThai ? "จำนวนสมาชิกแต่ละอาชีพ" : "Members per job"}
                </strong>
                <span>
                  {data.members.length} {isThai ? "คน" : "members"}
                </span>
              </div>
              <JobChart jobs={data.jobs} members={data.members} placedIds={placedIds} isThai={isThai} />
            </div>
          </div>

          {picked && (
            <div className="picked-banner">
              <span className="job-dot" style={jobStyle(jobOf(picked))} />
              {isThai ? `เลือก ${memberName(data, picked)} แล้ว แตะช่องในทีมที่ต้องการ${placedIds.has(picked) ? " หรือแตะกล่องตัวสำรองเพื่อนำออก" : ""}` : `${memberName(data, picked)} selected. Tap a team slot${placedIds.has(picked) ? ", or the reserves box to unplace" : ""}.`}
              {pickedParty && partyMatesFor(picked).length > 0 && (
                <em className="party-hint">
                  <Users2 size={11} /> {isThai ? `แตะช่องในทีมที่ต้องการ จะจัดทั้งปาร์ตี้ "${pickedParty.label}" ลงทีมนั้นให้เลย` : `Tap a slot on a team to seat the whole "${pickedParty.label}" party there`}
                </em>
              )}
              <button type="button" onClick={() => setPicked(null)}>
                {isThai ? "ยกเลิก" : "Cancel"}
              </button>
            </div>
          )}

          <div className="team-planner-layout">
            <aside
              className={`member-pool ${hoverTarget === "reserves" ? "hover" : ""}`}
              onDragOver={dragOver("reserves")}
              onDragLeave={() => setHoverTarget((current) => (current === "reserves" ? null : current))}
              onDrop={dropTo(null)}
              onClick={() => {
                if (picked && placedIds.has(picked)) void place(picked, null);
              }}
            >
              <div className="pool-title">
                <strong>{isThai ? "ตัวสำรอง (ลงทะเบียนแล้ว ยังไม่มีทีม)" : "Reserves (registered, not placed)"}</strong>
                <span>{reserves.length}</span>
              </div>
              <label className="team-search pool-search" onClick={(event) => event.stopPropagation()}>
                <Search size={14} />
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isThai ? "ค้นหาตัวสำรอง..." : "Search reserves..."} />
              </label>
              <ol className="reserve-list">
                {visibleReserves.map((reserve) => (
                  <li key={reserve.memberId}>
                    <span className="reserve-order">{reserve.order}</span>
                    {chip(reserve.memberId)}
                  </li>
                ))}
              </ol>
              {visibleReserves.length === 0 && <p className="empty-search">{query ? (isThai ? "ไม่พบ" : "No match.") : isThai ? "ไม่มีตัวสำรอง — ทุกคนที่ลงทะเบียนอยู่ในทีมแล้ว" : "No reserves — everyone registered is placed."}</p>}
            </aside>

            <div className="rooms">
              {plan.rooms.map((room, roomIndex) => {
                const placedInRoom = room.teams.reduce((total, team) => total + team.placements.length, 0);
                const clusters = groupTeams(room.teams);
                const groups = clusters.filter((cluster) => cluster.label !== null) as { label: string; teams: Team[] }[];
                const solo = clusters.filter((cluster) => cluster.label === null).flatMap((cluster) => cluster.teams);
                return (
                  <div className={`team-column ${roomIndex === 0 ? "team-a" : roomIndex === 1 ? "team-b" : ""}`} key={room.id}>
                    <h3>
                      {room.name}
                      <small>
                        {placedInRoom}/{room.capacity} · {room.teams.length} {isThai ? "ทีม" : "teams"}
                        {placedInRoom > 0 && cpCoverage > 0 && ` · CP ${formatCp(teamCp(room.teams.flatMap((team) => team.placements.map((p) => p.memberId))))}`}
                      </small>
                    </h3>
                    {groups.length > 0 && (
                      <div className="room-groups">
                        {groups.map((group) => (
                          <div className="team-group" key={group.label}>
                            <div className="team-group-title">
                              <strong>{group.label}</strong>
                              <small>
                                {group.teams.reduce((total, team) => total + team.placements.length, 0)}/{group.teams.reduce((total, team) => total + team.size, 0)}
                                {cpCoverage > 0 && group.teams.some((team) => team.placements.length) && <b className="team-cp"> · CP {formatCp(teamCp(group.teams.flatMap((team) => team.placements.map((p) => p.memberId))))}</b>}
                              </small>
                            </div>
                            <div className="group-subteams">{group.teams.map((team) => subteamCard(team))}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {solo.length > 0 && <div className="subteam-grid ungrouped">{solo.map((team) => subteamCard(team))}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {importDialog}
      {partyDialog}
    </section>
  );
}

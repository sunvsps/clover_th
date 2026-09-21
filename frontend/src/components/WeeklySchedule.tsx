import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock, Copy, Hammer, RotateCcw, Shield, Users, X } from "lucide-react";
import { registrations as registrationsApi, serverNow, type RegistrationEntry, type RegistrationStatus, type ScheduleEvent } from "../api";
import { findJob, jobStyle } from "../data/guild";
import { addDays, formatDay, startOfWeek, todayKey, weekDayNames, weekDayShort, yearOf } from "../lib/dates";
import { usePolling } from "../hooks/usePolling";
import { memberName, type ViewProps } from "../lib/types";

type Selection = { dateKey: string; event: ScheduleEvent };

/** Start of an occurrence as epoch ms (guild time is UTC+7 all year). */
const occurrenceStart = (dateKey: string, startTime: string) => Date.parse(`${dateKey}T${startTime}:00+07:00`);

export default function WeeklySchedule({ isThai, me, isAdmin, data, notify, notifyError }: ViewProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayKey()));
  const [selected, setSelected] = useState<Selection | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminTarget, setAdminTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = todayKey();
  const dayKeys = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const dayNames = isThai ? weekDayNames.th : weekDayNames.en;
  const shortNames = isThai ? weekDayShort.th : weekDayShort.en;
  const weekEnd = dayKeys[6];
  const weekLabel = `${formatDay(weekStart, isThai)} – ${formatDay(weekEnd, isThai)} ${yearOf(weekEnd)}`;
  const isCurrentWeek = dayKeys.includes(today);
  const events = data.events;
  const timeSlots = useMemo(() => [...new Set(events.map((event) => event.startTime))].sort(), [events]);
  const activityOf = (event: ScheduleEvent) => data.activities.find((activity) => activity.id === event.activityId);

  const { data: week, refresh } = usePolling(() => registrationsApi.list(weekStart, weekEnd), 10000, [weekStart]);
  const entriesFor = (dateKey: string, eventId: string): RegistrationEntry[] => week?.occurrences[`${dateKey}:${eventId}`] ?? week?.occurrences[`${eventId}:${dateKey}`] ?? [];
  const myEntry = (dateKey: string, eventId: string) => entriesFor(dateKey, eventId).find((entry) => entry.memberId === me.memberId);
  const byStatus = (dateKey: string, eventId: string, status: RegistrationEntry["status"]) => entriesFor(dateKey, eventId).filter((entry) => entry.status === status);
  const eventsAt = (slot: string, day: number) => events.filter((event) => event.startTime === slot && event.dayOfWeek === day);
  const eventsOn = (day: number) => [...events.filter((event) => event.dayOfWeek === day)].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const isClosed = (dateKey: string, event: ScheduleEvent) => occurrenceStart(dateKey, event.startTime) <= serverNow();

  const myJoined = dayKeys.flatMap((dateKey, day) => eventsOn(day).filter((event) => myEntry(dateKey, event.id)?.status === "JOINED" || myEntry(dateKey, event.id)?.status === "WAITLISTED")).length;
  const myLeave = dayKeys.flatMap((dateKey, day) => eventsOn(day).filter((event) => myEntry(dateKey, event.id)?.status === "LEAVE")).length;

  useEffect(() => {
    const container = scrollRef.current;
    const todayColumn = container?.querySelector<HTMLElement>(".schedule-day.today");
    if (!container || !todayColumn || container.scrollWidth <= container.clientWidth) return;
    container.scrollLeft = Math.max(0, todayColumn.offsetLeft - 66 - 8);
  }, [weekStart]);

  const adminMatches = adminSearch.trim() ? data.members.filter((member) => member.ign.toLowerCase().includes(adminSearch.trim().toLowerCase())).slice(0, 8) : [];

  async function setStatus(memberId: string, status: RegistrationStatus) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const result = await registrationsApi.set(selected.event.id, selected.dateKey, memberId, status);
      const who = memberId === me.memberId ? (isThai ? "คุณ" : "You") : memberName(data, memberId);
      const lines = [
        result.status === "JOINED"
          ? isThai ? `${who} ลงทะเบียนเล่นแล้ว` : `${who} registered as playing.`
          : result.status === "WAITLISTED"
            ? isThai ? `${who} อยู่ในรายชื่อสำรอง ลำดับ ${result.waitlistPosition ?? "?"}` : `${who} is waitlisted (#${result.waitlistPosition ?? "?"}).`
            : status === "LEAVE"
              ? isThai ? `บันทึกการลาของ ${who} แล้ว` : `Leave saved for ${who}.`
              : isThai ? `ล้างสถานะของ ${who} แล้ว` : `Status cleared for ${who}.`,
      ];
      if (result.promoted.length) lines.push(isThai ? `เลื่อนจากสำรอง: ${result.promoted.map((id) => memberName(data, id)).join(", ")}` : `Promoted from waitlist: ${result.promoted.map((id) => memberName(data, id)).join(", ")}`);
      if (result.backfilled.length) lines.push(isThai ? `ช่องในทีมถูกแทนโดย: ${result.backfilled.map((b) => `${memberName(data, b.promotedMemberId)} → ${b.teamName} #${b.slot}`).join(", ")}` : `Slot backfilled: ${result.backfilled.map((b) => `${memberName(data, b.promotedMemberId)} → ${b.teamName} #${b.slot}`).join(", ")}`);
      notify(lines.join(" · "));
      await refresh();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  function closeDialog() {
    setSelected(null);
    setAdminSearch("");
    setAdminTarget(null);
  }

  function copySummary() {
    const lines = [`Clover_TH ${isThai ? "ตารางกิจกรรม" : "activity roster"} ${weekLabel}`, ""];
    dayKeys.forEach((dateKey, day) => {
      const list = eventsOn(day).filter((event) => entriesFor(dateKey, event.id).length);
      if (!list.length) return;
      lines.push(`${dayNames[day]} ${formatDay(dateKey, isThai)}`);
      list.forEach((event) => {
        lines.push(`  ${event.name} (${event.startTime}-${event.endTime})`);
        const joined = byStatus(dateKey, event.id, "JOINED").map((entry) => memberName(data, entry.memberId));
        const waitlisted = byStatus(dateKey, event.id, "WAITLISTED").map((entry) => memberName(data, entry.memberId));
        const leave = byStatus(dateKey, event.id, "LEAVE").map((entry) => memberName(data, entry.memberId));
        if (joined.length) lines.push(`    ${isThai ? "ลงเล่น" : "Playing"}: ${joined.join(", ")}`);
        if (waitlisted.length) lines.push(`    ${isThai ? "สำรอง" : "Waitlist"}: ${waitlisted.join(", ")}`);
        if (leave.length) lines.push(`    ${isThai ? "ลา" : "Leave"}: ${leave.join(", ")}`);
      });
      lines.push("");
    });
    navigator.clipboard?.writeText(lines.join("\n").trim());
    notify(isThai ? "คัดลอกสรุปการลงทะเบียนแล้ว" : "Weekly roster copied to clipboard.");
  }

  const statusLabel = (status: RegistrationEntry["status"] | undefined, pos?: number) => {
    if (status === "JOINED") return isThai ? "ลงเล่น" : "Playing";
    if (status === "WAITLISTED") return isThai ? `สำรอง #${pos ?? "?"}` : `Waitlist #${pos ?? "?"}`;
    if (status === "LEAVE") return isThai ? "ลา" : "On leave";
    return isThai ? "ยังไม่เลือก" : "Not set";
  };

  const personChip = (entry: RegistrationEntry, dateKey: string, eventId: string) => {
    const member = data.membersById.get(entry.memberId);
    const status = entry.status === "WAITLISTED" ? "waitlisted" : entry.status === "LEAVE" ? "leave" : "joined";
    return (
      <span className={`person ${status}`} key={entry.memberId} title={member ? findJob(data.jobs, member.jobId)?.label : undefined}>
        <i className="job-dot" style={jobStyle(findJob(data.jobs, member?.jobId))} />
        {memberName(data, entry.memberId)}
        {entry.status === "WAITLISTED" && <small>#{entry.waitlistPos}</small>}
        {entry.placed && <small title={isThai ? "อยู่ในทีมแล้ว" : "Placed in a team"}>{isThai ? "ทีม" : "placed"}</small>}
        {!entry.placed && entry.reserveOrder != null && <small>{isThai ? `สำรอง ${entry.reserveOrder}` : `res ${entry.reserveOrder}`}</small>}
        {(isAdmin || entry.memberId === me.memberId) && selected?.dateKey === dateKey && selected.event.id === eventId && (
          <button type="button" onClick={() => setStatus(entry.memberId, "NONE")} aria-label={isThai ? "ล้าง" : "Clear"} disabled={busy}>
            <X size={10} />
          </button>
        )}
      </span>
    );
  };

  const selectedEntry = selected ? myEntry(selected.dateKey, selected.event.id) : undefined;
  const selectedActivity = selected ? activityOf(selected.event) : undefined;
  const selectedClosed = selected ? isClosed(selected.dateKey, selected.event) : false;

  return (
    <section className="feature-page schedule-page">
      <div className="feature-heading">
        <div>
          <p className="eyebrow">
            <CalendarDays size={13} /> WEEKLY ACTIVITY SCHEDULE
          </p>
          <h2>{isThai ? "ตารางกิจกรรมรายสัปดาห์" : "Weekly activity schedule"}</h2>
          <p>
            {isThai
              ? "กดที่กิจกรรมเพื่อลงทะเบียนว่าจะเล่น หรือกดลาในกิจกรรมที่ไม่สะดวก ปิดลงทะเบียนอัตโนมัติเมื่อกิจกรรมเริ่ม"
              : "Tap an activity to register as playing, or mark leave. Registration closes automatically when the activity starts."}
          </p>
        </div>
        <div className="schedule-stats">
          <span>
            <i className="status-dot joined" /> {isThai ? "ฉันลงเล่น" : "Me playing"} <strong>{myJoined}</strong>
          </span>
          <span>
            <i className="status-dot leave" /> {isThai ? "ฉันลา" : "Me on leave"} <strong>{myLeave}</strong>
          </span>
        </div>
      </div>

      <div className="week-toolbar">
        <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
          <ArrowLeft size={15} />
        </button>
        <div className="week-label">
          <strong>{weekLabel}</strong>
          <small>{isCurrentWeek ? (isThai ? "สัปดาห์นี้" : "This week") : isThai ? "สัปดาห์อื่น" : "Another week"}</small>
        </div>
        <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
          <ArrowRight size={15} />
        </button>
        <button type="button" className="today-button" disabled={isCurrentWeek} onClick={() => setWeekStart(startOfWeek(todayKey()))}>
          {isThai ? "วันนี้" : "Today"}
        </button>
      </div>

      <div className="schedule-scroll" ref={scrollRef}>
        <div className="schedule-grid" role="grid" aria-label="Weekly schedule">
          <span className="schedule-corner" />
          {dayKeys.map((dateKey, index) => (
            <span className={`schedule-day ${dateKey === today ? "today" : ""}`} key={dateKey} role="columnheader">
              <span>{dayNames[index]}</span>
              <strong>{formatDay(dateKey, isThai)}</strong>
            </span>
          ))}
          {timeSlots.map((slot) => (
            <div className="schedule-row" role="row" key={slot}>
              <span className="schedule-time">{slot}</span>
              {dayKeys.map((dateKey, day) => (
                <div className={`schedule-cell ${dateKey === today ? "today" : ""} ${dateKey < today ? "past" : ""}`} role="gridcell" key={`${slot}-${dateKey}`}>
                  {eventsAt(slot, day).map((event) => {
                    const mine = myEntry(dateKey, event.id);
                    const status = mine?.status === "LEAVE" ? "leave" : mine ? "joined" : "";
                    const joinedCount = byStatus(dateKey, event.id, "JOINED").length;
                    const leaveCount = byStatus(dateKey, event.id, "LEAVE").length;
                    const activity = activityOf(event);
                    const isSelected = selected?.dateKey === dateKey && selected.event.id === event.id;
                    return (
                      <button
                        type="button"
                        className={`schedule-event ${event.isGuild ? "highlight" : ""} ${status} ${isSelected ? "selected" : ""} ${isClosed(dateKey, event) ? "closed" : ""}`}
                        key={event.id}
                        onClick={() => setSelected({ dateKey, event })}
                        title={`${event.name} ${event.startTime}-${event.endTime}`}
                      >
                        {event.isGuild && <Hammer size={12} className="guild-mark" />}
                        <span className="event-name">{event.name}</span>
                        <span className="event-time">
                          {event.startTime}-{event.endTime}
                        </span>
                        <span className="event-meta">
                          {mine && (
                            <small className={`event-status ${status}`}>
                              {mine.status === "LEAVE" ? <X size={10} /> : <Check size={10} />}
                              {mine.status === "LEAVE" ? (isThai ? "ลา" : "OUT") : mine.status === "WAITLISTED" ? `#${mine.waitlistPos}` : isThai ? "เล่น" : "IN"}
                            </small>
                          )}
                          {(joinedCount > 0 || leaveCount > 0) && (
                            <small className="event-counts">
                              <Users size={9} /> {joinedCount}
                              {activity?.registrationCapacity != null && `/${activity.registrationCapacity}`}
                              {leaveCount > 0 && <> · <X size={9} /> {leaveCount}</>}
                            </small>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="schedule-legend">
        <span>
          <i className="legend-swatch highlight" /> <Hammer size={12} /> {isThai ? "กิจกรรมกิลด์" : "Guild activity"}
        </span>
        <span>
          <i className="status-dot joined" /> {isThai ? "ฉันลงเล่น" : "I'm playing"}
        </span>
        <span>
          <i className="status-dot leave" /> {isThai ? "ฉันลา" : "I'm on leave"}
        </span>
        <span>
          <Clock size={12} /> {isThai ? "จางลง = ปิดลงทะเบียนแล้ว" : "Faded = registration closed"}
        </span>
      </div>

      <section className="day-summary">
        <div className="section-heading summary-heading">
          <div>
            <p className="eyebrow">ROSTER BY DATE</p>
            <h2>{isThai ? "สรุปการลงทะเบียนตามวัน" : "Registrations by date"}</h2>
          </div>
          <button className="copy-button" type="button" onClick={copySummary}>
            <Copy size={15} /> {isThai ? "คัดลอกสรุป" : "Copy roster"}
          </button>
        </div>
        <div className="day-summary-grid">
          {dayKeys.map((dateKey, day) => {
            const list = eventsOn(day);
            if (!list.length) return null;
            const hasAny = list.some((event) => entriesFor(dateKey, event.id).length);
            return (
              <article className={`day-card ${dateKey === today ? "today" : ""}`} key={dateKey}>
                <header>
                  <span className="day-card-dow">{shortNames[day]}</span>
                  <strong>{formatDay(dateKey, isThai)}</strong>
                  {dateKey === today && <em>{isThai ? "วันนี้" : "Today"}</em>}
                </header>
                {!hasAny && <p className="empty-search">{isThai ? "ยังไม่มีใครลงทะเบียน" : "No registrations yet."}</p>}
                {list.map((event) => {
                  const entries = entriesFor(dateKey, event.id);
                  return (
                    <div className="day-event" key={event.id}>
                      <button type="button" className="day-event-title" onClick={() => setSelected({ dateKey, event })}>
                        {event.isGuild ? <Hammer size={12} /> : <i className="legend-swatch" />}
                        <span>{event.name}</span>
                        <small>
                          {event.startTime}-{event.endTime}
                        </small>
                      </button>
                      {entries.length > 0 && <div className="day-event-people">{entries.map((entry) => personChip(entry, dateKey, event.id))}</div>}
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      </section>

      {selected && (
        <div className="page-modal-backdrop" role="presentation" onClick={closeDialog}>
          <section className="page-modal event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title" onClick={(event) => event.stopPropagation()}>
            <div className="page-modal-header">
              <div>
                <p className="eyebrow">
                  {selected.event.isGuild && <Hammer size={11} />} {dayNames[selected.event.dayOfWeek]} {formatDay(selected.dateKey, isThai)} · {selected.event.startTime}-{selected.event.endTime}
                </p>
                <h2 id="event-dialog-title">{selected.event.name}</h2>
                <small className="event-dialog-status">
                  {isThai ? "สถานะของฉัน" : "My status"}: <strong className={selectedEntry?.status === "LEAVE" ? "leave" : selectedEntry ? "joined" : ""}>{statusLabel(selectedEntry?.status, selectedEntry?.waitlistPos)}</strong>
                  {selectedActivity?.registrationCapacity != null && (
                    <>
                      {" · "}
                      {isThai ? "รับ" : "Capacity"} {byStatus(selected.dateKey, selected.event.id, "JOINED").length}/{selectedActivity.registrationCapacity}
                    </>
                  )}
                  {selectedClosed && <> · {isThai ? "ปิดลงทะเบียนแล้ว" : "Registration closed"}</>}
                </small>
              </div>
              <button type="button" className="modal-close" onClick={closeDialog} aria-label="Close">
                ×
              </button>
            </div>
            <div className="event-dialog-actions">
              <button type="button" className="join-button" disabled={busy || (selectedClosed && !isAdmin)} onClick={() => setStatus(me.memberId, "JOINED")}>
                <Check size={15} /> {isThai ? "ลงทะเบียนเล่น" : "I'm playing"}
              </button>
              <button type="button" className="leave-button" disabled={busy || (selectedClosed && !isAdmin)} onClick={() => setStatus(me.memberId, "LEAVE")}>
                <X size={15} /> {isThai ? "ลา ไม่เล่นกิจกรรมนี้" : "Mark leave"}
              </button>
              {selectedEntry && (
                <button type="button" className="clear-button" disabled={busy || (selectedClosed && !isAdmin)} onClick={() => setStatus(me.memberId, "NONE")}>
                  <RotateCcw size={13} /> {isThai ? "ล้างสถานะ" : "Clear"}
                </button>
              )}
            </div>

            {isAdmin && (
              <div className="admin-entry">
                <p className="eyebrow">
                  <Shield size={11} /> {isThai ? "แอดมิน: บันทึกแทนสมาชิก" : "ADMIN: RECORD FOR A MEMBER"}
                </p>
                <div className="admin-entry-row">
                  <div className="admin-entry-search">
                    <input
                      type="search"
                      value={adminTarget ? memberName(data, adminTarget) : adminSearch}
                      placeholder={isThai ? "พิมพ์ชื่อสมาชิก..." : "Type a member name..."}
                      onChange={(event) => {
                        setAdminTarget(null);
                        setAdminSearch(event.target.value);
                      }}
                    />
                    {!adminTarget && adminMatches.length > 0 && (
                      <ul className="admin-entry-matches">
                        {adminMatches.map((member) => (
                          <li key={member.id}>
                            <button type="button" onClick={() => setAdminTarget(member.id)}>
                              <i className="job-dot" style={jobStyle(findJob(data.jobs, member.jobId))} /> {member.ign}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button type="button" className="admin-button" disabled={!adminTarget || busy} onClick={() => adminTarget && setStatus(adminTarget, "JOINED")}>
                    <Check size={13} /> {isThai ? "เล่น" : "Playing"}
                  </button>
                  <button type="button" className="admin-button leave" disabled={!adminTarget || busy} onClick={() => adminTarget && setStatus(adminTarget, "LEAVE")}>
                    <X size={13} /> {isThai ? "ลา" : "Leave"}
                  </button>
                </div>
              </div>
            )}

            <div className="event-roster">
              {(["JOINED", "WAITLISTED", "LEAVE"] as const).map((status) => {
                const people = byStatus(selected.dateKey, selected.event.id, status);
                if (status === "WAITLISTED" && people.length === 0) return null;
                return (
                  <div key={status}>
                    <span className="eyebrow">
                      {status === "LEAVE" ? <X size={11} /> : <Users size={11} />} {status === "JOINED" ? (isThai ? "ลงเล่น" : "PLAYING") : status === "WAITLISTED" ? (isThai ? "สำรอง" : "WAITLIST") : isThai ? "ลา" : "ON LEAVE"} ({people.length})
                    </span>
                    {people.length === 0 ? <p>—</p> : <div className="roster-people">{people.map((entry) => personChip(entry, selected.dateKey, selected.event.id))}</div>}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

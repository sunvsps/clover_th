import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Copy, Hammer, RotateCcw, Shield, Users, X } from "lucide-react";
import { addDays, formatDay, startOfWeek, todayKey, yearOf } from "../lib/bangkok";
import {
  attendanceKey,
  timeSlotsOf,
  weekDayNames,
  weekDayShort,
  findJob,
  jobStyle,
  type Attendance,
  type GuildMember,
  type Job,
  type ScheduleEvent,
} from "../data/guild";

/** attendanceKey("YYYY-MM-DD", eventId) -> memberId -> status */
export type AttendanceBook = Record<string, Record<string, Attendance>>;

type Props = {
  isThai: boolean;
  /** the signed-in member; attendance is keyed by memberId */
  memberId: string;
  isAdmin: boolean;
  events: ScheduleEvent[];
  jobs: Job[];
  members: GuildMember[];
  attendance: AttendanceBook;
  onSetAttendance: (key: string, memberId: string, status: Attendance | null) => void;
  onNotice: (message: string) => void;
};

type Selection = { dateKey: string; event: ScheduleEvent };

function statusLabel(status: Attendance | undefined, isThai: boolean) {
  if (status === "joined") return isThai ? "ลงเล่น" : "Playing";
  if (status === "leave") return isThai ? "ลา" : "On leave";
  return isThai ? "ยังไม่เลือก" : "Not set";
}

export default function WeeklySchedule({ isThai, memberId, isAdmin, events, jobs, members, attendance, onSetAttendance, onNotice }: Props) {
  // Days are Bangkok calendar date keys ("YYYY-MM-DD"), never browser-local Dates.
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayKey()));
  const [selected, setSelected] = useState<Selection | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminTarget, setAdminTarget] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = todayKey();
  const timeSlots = useMemo(() => timeSlotsOf(events), [events]);
  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const ignOf = (id: string) => byId.get(id)?.ign ?? id;
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const dayKeys = days;
  const dayNames = isThai ? weekDayNames.th : weekDayNames.en;
  const shortNames = isThai ? weekDayShort.th : weekDayShort.en;
  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `${formatDay(weekStart, isThai)} – ${formatDay(weekEnd, isThai)} ${yearOf(weekEnd)}`;
  const isCurrentWeek = dayKeys.includes(today);

  const book = (dateKey: string, eventId: string) => attendance[attendanceKey(dateKey, eventId)] ?? {};
  const myStatus = (dateKey: string, eventId: string) => book(dateKey, eventId)[memberId];
  const roster = (dateKey: string, eventId: string, status: Attendance) =>
    Object.entries(book(dateKey, eventId))
      .filter(([, value]) => value === status)
      .map(([member]) => member);
  const eventsAt = (slot: string, day: number) => events.filter((event) => event.slot === slot && event.day === day);
  const eventsOn = (day: number) =>
    [...events.filter((event) => event.day === day)].sort((a, b) => a.start.localeCompare(b.start));

  const weekEntries = dayKeys.flatMap((dateKey, day) =>
    eventsOn(day).map((event) => ({ dateKey, event, joined: roster(dateKey, event.id, "joined"), leave: roster(dateKey, event.id, "leave") })),
  );
  const myJoined = weekEntries.filter(({ dateKey, event }) => myStatus(dateKey, event.id) === "joined").length;
  const myLeave = weekEntries.filter(({ dateKey, event }) => myStatus(dateKey, event.id) === "leave").length;
  const weekJoined = weekEntries.reduce((total, entry) => total + entry.joined.length, 0);
  const weekLeave = weekEntries.reduce((total, entry) => total + entry.leave.length, 0);

  // On narrow screens the grid scrolls sideways; bring today's column into view.
  useEffect(() => {
    const container = scrollRef.current;
    const today = container?.querySelector<HTMLElement>(".schedule-day.today");
    if (!container || !today || container.scrollWidth <= container.clientWidth) return;
    container.scrollLeft = Math.max(0, today.offsetLeft - 66 - 8);
  }, [weekStart]);

  const adminMatches = adminSearch.trim()
    ? members.filter((member) => member.ign.toLowerCase().includes(adminSearch.trim().toLowerCase())).slice(0, 8)
    : [];

  function chooseMine(status: Attendance | null) {
    if (!selected) return;
    onSetAttendance(attendanceKey(selected.dateKey, selected.event.id), memberId, status);
    setSelected(null);
  }

  function chooseFor(member: string, status: Attendance | null) { // member = memberId
    if (!selected) return;
    onSetAttendance(attendanceKey(selected.dateKey, selected.event.id), member, status);
  }

  function closeDialog() {
    setSelected(null);
    setAdminSearch("");
    setAdminTarget(null);
  }

  function copySummary() {
    const lines = [`Clover_TH ${isThai ? "ตารางกิจกรรม" : "activity roster"} ${weekLabel}`, ""];
    dayKeys.forEach((dateKey, day) => {
      const entries = weekEntries.filter((entry) => entry.dateKey === dateKey && (entry.joined.length || entry.leave.length));
      if (entries.length === 0) return;
      lines.push(`${dayNames[day]} ${formatDay(days[day], isThai)}`);
      entries.forEach(({ event, joined, leave }) => {
        lines.push(`  ${event.name} (${event.start}-${event.end})`);
        if (joined.length) lines.push(`    ${isThai ? "ลงเล่น" : "Playing"}: ${joined.map(ignOf).join(", ")}`);
        if (leave.length) lines.push(`    ${isThai ? "ลา" : "Leave"}: ${leave.map(ignOf).join(", ")}`);
      });
      lines.push("");
    });
    navigator.clipboard?.writeText(lines.join("\n").trim());
    onNotice(isThai ? "คัดลอกสรุปการลงทะเบียนแล้ว" : "Weekly roster copied to clipboard.");
  }

  const selectedStatus = selected ? myStatus(selected.dateKey, selected.event.id) : undefined;
  const selectedDate = selected ? days[dayKeys.indexOf(selected.dateKey)] : null;

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
              ? "กดที่กิจกรรมเพื่อลงทะเบียนว่าจะเล่น หรือกดลาในกิจกรรมที่ไม่สะดวก แอดมินบันทึกแทนสมาชิกคนอื่นได้"
              : "Tap an activity to register as playing, or mark leave for the ones you cannot attend. Admins can record on behalf of other members."}
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
        <button type="button" className="today-button" disabled={isCurrentWeek} onClick={() => setWeekStart(startOfWeek(today))}>
          {isThai ? "วันนี้" : "Today"}
        </button>
      </div>

      <div className="schedule-scroll" ref={scrollRef}>
        <div className="schedule-grid" role="grid" aria-label="Weekly schedule">
          <span className="schedule-corner" />
          {days.map((date, index) => (
            <span
              className={`schedule-day ${index >= 5 ? "weekend" : ""} ${dayKeys[index] === today ? "today" : ""}`}
              key={dayKeys[index]}
              role="columnheader"
            >
              <span>{dayNames[index]}</span>
              <strong>{formatDay(date, isThai)}</strong>
            </span>
          ))}
          {timeSlots.map((slot) => (
            <div className="schedule-row" role="row" key={slot}>
              <span className="schedule-time">{slot}</span>
              {dayKeys.map((dateKey, day) => (
                <div className={`schedule-cell ${dateKey === today ? "today" : ""} ${dateKey < today ? "past" : ""}`} role="gridcell" key={`${slot}-${dateKey}`}>
                  {eventsAt(slot, day).map((event) => {
                    const status = myStatus(dateKey, event.id);
                    const joinedCount = roster(dateKey, event.id, "joined").length;
                    const leaveCount = roster(dateKey, event.id, "leave").length;
                    const isSelected = selected?.dateKey === dateKey && selected.event.id === event.id;
                    return (
                      <button
                        type="button"
                        className={`schedule-event ${status ?? ""} ${isSelected ? "selected" : ""}`}
                        key={event.id}
                        onClick={() => setSelected({ dateKey, event })}
                        title={`${event.name} ${event.start}-${event.end}`}
                      >
                        {event.guild && <Hammer size={12} className="guild-mark" />}
                        <span className="event-name">{event.name}</span>
                        <span className="event-time">
                          {event.start}-{event.end}
                        </span>
                        <span className="event-meta">
                          {status && (
                            <small className={`event-status ${status}`}>
                              {status === "joined" ? <Check size={10} /> : <X size={10} />}
                              {status === "joined" ? (isThai ? "เล่น" : "IN") : isThai ? "ลา" : "OUT"}
                            </small>
                          )}
                          {(joinedCount > 0 || leaveCount > 0) && (
                            <small className="event-counts">
                              <Users size={9} /> {joinedCount}
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
          <Hammer size={12} /> {isThai ? "กิจกรรมกิลด์" : "Guild activity"}
        </span>
        <span>
          <i className="status-dot joined" /> {isThai ? "ฉันลงเล่น" : "I'm playing"}
        </span>
        <span>
          <i className="status-dot leave" /> {isThai ? "ฉันลา" : "I'm on leave"}
        </span>
        <span>
          <Users size={12} /> {isThai ? "จำนวนคนลงเล่น · ลา" : "Playing · leave count"}
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
        <div className="summary-meta">
          <span>
            <Users size={15} /> {weekJoined} {isThai ? "การลงเล่น" : "playing entries"}
          </span>
          <span>
            <X size={15} /> {weekLeave} {isThai ? "การลา" : "leave entries"}
          </span>
        </div>
        <div className="day-summary-grid">
          {dayKeys.map((dateKey, day) => {
            const entries = weekEntries.filter((entry) => entry.dateKey === dateKey);
            if (entries.length === 0) return null;
            const hasAny = entries.some((entry) => entry.joined.length || entry.leave.length);
            return (
              <article className={`day-card ${dateKey === today ? "today" : ""}`} key={dateKey}>
                <header>
                  <span className="day-card-dow">{shortNames[day]}</span>
                  <strong>{formatDay(days[day], isThai)}</strong>
                  {dateKey === today && <em>{isThai ? "วันนี้" : "Today"}</em>}
                </header>
                {!hasAny && <p className="empty-search">{isThai ? "ยังไม่มีใครลงทะเบียน" : "No registrations yet."}</p>}
                {entries.map(({ event, joined, leave }) => (
                  <div className="day-event" key={event.id}>
                    <button type="button" className="day-event-title" onClick={() => setSelected({ dateKey, event })}>
                      {event.guild ? <Hammer size={12} /> : <i className="legend-swatch" />}
                      <span>{event.name}</span>
                      <small>
                        {event.start}-{event.end}
                      </small>
                    </button>
                    {(joined.length > 0 || leave.length > 0) && (
                      <div className="day-event-people">
                        {joined.map((member) => (
                          <span className="person joined" key={`j-${member}`}>
                            <Check size={10} /> {ignOf(member)}
                          </span>
                        ))}
                        {leave.map((member) => (
                          <span className="person leave" key={`l-${member}`}>
                            <X size={10} /> {ignOf(member)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </article>
            );
          })}
        </div>
      </section>

      {selected && selectedDate && (
        <div className="page-modal-backdrop" role="presentation" onClick={closeDialog}>
          <section
            className="page-modal event-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="page-modal-header">
              <div>
                <p className="eyebrow">
                  {selected.event.guild && <Hammer size={11} />} {dayNames[selected.event.day]} {formatDay(selectedDate, isThai)} · {selected.event.start}-
                  {selected.event.end}
                </p>
                <h2 id="event-dialog-title">{selected.event.name}</h2>
                <small className="event-dialog-status">
                  {isThai ? "สถานะของฉัน" : "My status"}: <strong className={selectedStatus ?? ""}>{statusLabel(selectedStatus, isThai)}</strong>
                </small>
              </div>
              <button type="button" className="modal-close" onClick={closeDialog} aria-label="Close">
                ×
              </button>
            </div>
            <div className="event-dialog-actions">
              <button type="button" className="join-button" onClick={() => chooseMine("joined")}>
                <Check size={15} /> {isThai ? "ลงทะเบียนเล่น" : "I'm playing"}
              </button>
              <button type="button" className="leave-button" onClick={() => chooseMine("leave")}>
                <X size={15} /> {isThai ? "ลา ไม่เล่นกิจกรรมนี้" : "Mark leave"}
              </button>
              {selectedStatus && (
                <button type="button" className="clear-button" onClick={() => chooseMine(null)}>
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
                      value={adminTarget ? ignOf(adminTarget) : adminSearch}
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
                              <i className="job-dot" style={jobStyle(findJob(jobs, member.job))} /> {member.ign}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button type="button" className="admin-button" disabled={!adminTarget} onClick={() => adminTarget && chooseFor(adminTarget, "joined")}>
                    <Check size={13} /> {isThai ? "เล่น" : "Playing"}
                  </button>
                  <button type="button" className="admin-button leave" disabled={!adminTarget} onClick={() => adminTarget && chooseFor(adminTarget, "leave")}>
                    <X size={13} /> {isThai ? "ลา" : "Leave"}
                  </button>
                </div>
              </div>
            )}

            <div className="event-roster">
              {(["joined", "leave"] as Attendance[]).map((status) => {
                const people = roster(selected.dateKey, selected.event.id, status);
                return (
                  <div key={status}>
                    <span className="eyebrow">
                      {status === "joined" ? <Users size={11} /> : <X size={11} />} {status === "joined" ? (isThai ? "ลงเล่น" : "PLAYING") : isThai ? "ลา" : "ON LEAVE"} ({people.length})
                    </span>
                    {people.length === 0 ? (
                      <p>—</p>
                    ) : (
                      <div className="roster-people">
                        {people.map((member) => (
                          <span className={`person ${status}`} key={member}>
                            {ignOf(member)}
                            {(isAdmin || member === memberId) && (
                              <button type="button" onClick={() => chooseFor(member, null)} aria-label={isThai ? "ล้าง" : "Clear"}>
                                <X size={10} />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
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

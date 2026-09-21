import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Copy, Hammer, RotateCcw, Shield, Users, X } from "lucide-react";
import {
  getRegistrations,
  isApiError,
  serverClock,
  setRegistration,
  usePolling,
  type Registration,
  type RegistrationBook,
  type WireActivity,
} from "../api";
import { addDays, formatDay, occurrenceStartMs, startOfWeek, todayKey, yearOf } from "../lib/bangkok";
import { joinedOf, leaveOf, myChangeNotices, placementLabel, rowsOf, statusText, waitlistOf, writeNotices } from "./scheduleModel";
import {
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

const POLL_MS = 20_000;

type Props = {
  isThai: boolean;
  /** the signed-in member; attendance is keyed by memberId */
  memberId: string;
  isAdmin: boolean;
  events: ScheduleEvent[];
  jobs: Job[];
  members: GuildMember[];
  /** for `registrationCapacity` and `hasPlanner` */
  activities: WireActivity[];
  onNotice: (message: string) => void;
};

type Selection = { dateKey: string; event: ScheduleEvent };

export default function WeeklySchedule({ isThai, memberId, isAdmin, events, jobs, members, activities, onNotice }: Props) {
  // Days are Bangkok calendar date keys ("YYYY-MM-DD"), never browser-local Dates.
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayKey()));
  const [selected, setSelected] = useState<Selection | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminTarget, setAdminTarget] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = todayKey();
  const timeSlots = useMemo(() => timeSlotsOf(events), [events]);
  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const ignOf = (id: string) => byId.get(id)?.ign ?? (isThai ? "อดีตสมาชิก" : "Former member");
  const activityOf = (event: ScheduleEvent) => activities.find((a) => a.id === event.activityId);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const dayKeys = days;
  const dayNames = isThai ? weekDayNames.th : weekDayNames.en;
  const shortNames = isThai ? weekDayShort.th : weekDayShort.en;
  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `${formatDay(weekStart, isThai)} – ${formatDay(weekEnd, isThai)} ${yearOf(weekEnd)}`;
  const isCurrentWeek = dayKeys.includes(today);

  const eventsAt = (slot: string, day: number) => events.filter((event) => event.slot === slot && event.day === day);
  const eventsOn = (day: number) =>
    [...events.filter((event) => event.day === day)].sort((a, b) => a.start.localeCompare(b.start));

  // The registrations of the visible week come from the API: refetched after every write, on focus and every 20 s.
  const registrations = usePolling<RegistrationBook>((signal) => getRegistrations(weekStart, weekEnd, signal), {
    intervalMs: POLL_MS,
    key: weekStart,
  });
  const book = registrations.data;
  const rows = (dateKey: string, eventId: string) => rowsOf(book, dateKey, eventId);
  const myRow = (dateKey: string, eventId: string): Registration | undefined =>
    rows(dateKey, eventId).find((r) => r.memberId === memberId);
  const isClosed = (dateKey: string, event: ScheduleEvent) => serverClock.now() >= occurrenceStartMs(dateKey, event.start);
  const [busy, setBusy] = useState(false);

  // Tell me when someone else's action changed my own registration (waitlist promotion, reserve to placed).
  const previousBook = useRef<RegistrationBook | null>(null);
  useEffect(() => {
    if (!book) return;
    const before = previousBook.current;
    previousBook.current = book;
    if (!before) return;
    const nameOf = (key: string) => {
      const event = events.find((e) => e.id === key.slice(11));
      return `${event?.name ?? ""} ${key.slice(0, 10)}`.trim();
    };
    for (const message of myChangeNotices(before, book, memberId, isThai, nameOf)) onNotice(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  const weekEntries = dayKeys.flatMap((dateKey, day) =>
    eventsOn(day).map((event) => {
      const all = rows(dateKey, event.id);
      return { dateKey, event, joined: joinedOf(all), waitlist: waitlistOf(all), leave: leaveOf(all) };
    }),
  );
  const myJoined = weekEntries.filter(({ dateKey, event }) => myRow(dateKey, event.id)?.status === "joined").length;
  const myLeave = weekEntries.filter(({ dateKey, event }) => myRow(dateKey, event.id)?.status === "leave").length;
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

  /** One write to the API (own status via `me`, or an admin recording for someone), then a refetch of the week. */
  async function write(target: string, status: Attendance | null) {
    if (!selected || busy) return;
    const { dateKey, event } = selected;
    setBusy(true);
    try {
      const result = await setRegistration(event.id, dateKey, target === memberId ? "me" : target, status);
      for (const message of writeNotices(result, { me: memberId, target, isThai, ignOf })) onNotice(message);
    } catch (err) {
      onNotice(isApiError(err) ? err.userMessage(isThai) : isThai ? "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง" : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      registrations.refresh();
    }
  }

  const chooseMine = (status: Attendance | null) => write(memberId, status);
  const chooseFor = (member: string, status: Attendance | null) => write(member, status);

  function closeDialog() {
    setSelected(null);
    setAdminSearch("");
    setAdminTarget(null);
  }

  function copySummary() {
    const lines = [`Clover_TH ${isThai ? "ตารางกิจกรรม" : "activity roster"} ${weekLabel}`, ""];
    dayKeys.forEach((dateKey, day) => {
      const entries = weekEntries.filter((entry) => entry.dateKey === dateKey && (entry.joined.length || entry.waitlist.length || entry.leave.length));
      if (entries.length === 0) return;
      lines.push(`${dayNames[day]} ${formatDay(days[day], isThai)}`);
      entries.forEach(({ event, joined, waitlist, leave }) => {
        lines.push(`  ${event.name} (${event.start}-${event.end})`);
        const tag = (r: Registration) => {
          const place = placementLabel(r, isThai);
          return place && !r.placed ? `${ignOf(r.memberId)} (${place})` : ignOf(r.memberId);
        };
        if (joined.length) lines.push(`    ${isThai ? "ลงเล่น" : "Playing"}: ${joined.map(tag).join(", ")}`);
        if (waitlist.length) lines.push(`    ${isThai ? "คิวสำรอง" : "Waitlist"}: ${waitlist.map((r) => `${r.waitlistPos}. ${ignOf(r.memberId)}`).join(", ")}`);
        if (leave.length) lines.push(`    ${isThai ? "ลา" : "Leave"}: ${leave.map((r) => ignOf(r.memberId)).join(", ")}`);
      });
      lines.push("");
    });
    navigator.clipboard?.writeText(lines.join("\n").trim());
    onNotice(isThai ? "คัดลอกสรุปการลงทะเบียนแล้ว" : "Weekly roster copied to clipboard.");
  }

  const selectedMine = selected ? myRow(selected.dateKey, selected.event.id) : undefined;
  const selectedClosed = selected ? isClosed(selected.dateKey, selected.event) : false;
  const selectedRows = selected ? rows(selected.dateKey, selected.event.id) : [];
  const cantChange = selectedClosed && !isAdmin; // closed occurrences only accept changes from admins
  const capacityText = (joined: number, event: ScheduleEvent) => {
    const cap = activityOf(event)?.registrationCapacity;
    return cap ? `${joined}/${cap}` : null;
  };
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

      {registrations.error && (
        <p className="schedule-error" role="alert">
          {registrations.error.userMessage(isThai)}
        </p>
      )}

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
                    const mine = myRow(dateKey, event.id);
                    const status = mine?.status;
                    const all = rows(dateKey, event.id);
                    const joinedCount = joinedOf(all).length;
                    const waitCount = waitlistOf(all).length;
                    const leaveCount = leaveOf(all).length;
                    const capacity = capacityText(joinedCount, event);
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
                          {mine && (
                            <small className={`event-status ${status}`}>
                              {status === "leave" ? <X size={10} /> : <Check size={10} />}
                              {status === "joined"
                                ? placementLabel(mine, isThai) ?? (isThai ? "เล่น" : "IN")
                                : status === "waitlisted"
                                  ? isThai ? `คิว #${mine.waitlistPos}` : `WAIT #${mine.waitlistPos}`
                                  : isThai ? "ลา" : "OUT"}
                            </small>
                          )}
                          {capacity && <small className="event-capacity">{capacity}</small>}
                          {(joinedCount > 0 || leaveCount > 0 || waitCount > 0) && (
                            <small className="event-counts">
                              <Users size={9} /> {joinedCount}
                              {waitCount > 0 && <> · {isThai ? "คิว" : "wait"} {waitCount}</>}
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
            const hasAny = entries.some((entry) => entry.joined.length || entry.waitlist.length || entry.leave.length);
            return (
              <article className={`day-card ${dateKey === today ? "today" : ""}`} key={dateKey}>
                <header>
                  <span className="day-card-dow">{shortNames[day]}</span>
                  <strong>{formatDay(days[day], isThai)}</strong>
                  {dateKey === today && <em>{isThai ? "วันนี้" : "Today"}</em>}
                </header>
                {!hasAny && <p className="empty-search">{isThai ? "ยังไม่มีใครลงทะเบียน" : "No registrations yet."}</p>}
                {entries.map(({ event, joined, waitlist, leave }) => (
                  <div className="day-event" key={event.id}>
                    <button type="button" className="day-event-title" onClick={() => setSelected({ dateKey, event })}>
                      {event.guild ? <Hammer size={12} /> : <i className="legend-swatch" />}
                      <span>{event.name}</span>
                      <small>
                        {event.start}-{event.end}
                      </small>
                    </button>
                    {(joined.length > 0 || waitlist.length > 0 || leave.length > 0) && (
                      <div className="day-event-people">
                        {joined.map((r) => (
                          <span className="person joined" key={`j-${r.memberId}`}>
                            <Check size={10} /> {ignOf(r.memberId)}
                            {placementLabel(r, isThai) && <small> · {placementLabel(r, isThai)}</small>}
                          </span>
                        ))}
                        {waitlist.map((r) => (
                          <span className="person waitlisted" key={`w-${r.memberId}`}>
                            #{r.waitlistPos} {ignOf(r.memberId)}
                          </span>
                        ))}
                        {leave.map((r) => (
                          <span className="person leave" key={`l-${r.memberId}`}>
                            <X size={10} /> {ignOf(r.memberId)}
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
                  {isThai ? "สถานะของฉัน" : "My status"}: <strong className={selectedMine?.status ?? ""}>{statusText(selectedMine, isThai)}</strong>
                </small>
                {capacityText(joinedOf(selectedRows).length, selected.event) && (
                  <small className="event-capacity-badge">
                    {isThai ? "จำนวนที่รับ" : "Capacity"}: <strong>{capacityText(joinedOf(selectedRows).length, selected.event)}</strong>
                  </small>
                )}
                {selectedClosed && (
                  <small className="event-closed" role="status">
                    {isThai ? "ปิดลงทะเบียนแล้ว: กิจกรรมเริ่มไปแล้ว" : "Registration closed: the activity has started."}
                    {isAdmin && (isThai ? " (แอดมินยังแก้ไขได้)" : " (admins can still change it)")}
                  </small>
                )}
              </div>
              <button type="button" className="modal-close" onClick={closeDialog} aria-label="Close">
                ×
              </button>
            </div>
            <div className="event-dialog-actions">
              <button type="button" className="join-button" disabled={cantChange || busy} onClick={() => void chooseMine("joined")}>
                <Check size={15} /> {isThai ? "ลงทะเบียนเล่น" : "I'm playing"}
              </button>
              <button type="button" className="leave-button" disabled={cantChange || busy} onClick={() => void chooseMine("leave")}>
                <X size={15} /> {isThai ? "ลา ไม่เล่นกิจกรรมนี้" : "Mark leave"}
              </button>
              {selectedMine && (
                <button type="button" className="clear-button" disabled={cantChange || busy} onClick={() => void chooseMine(null)}>
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
                  <button type="button" className="admin-button" disabled={!adminTarget || busy} onClick={() => adminTarget && void chooseFor(adminTarget, "joined")}>
                    <Check size={13} /> {isThai ? "เล่น" : "Playing"}
                  </button>
                  <button type="button" className="admin-button leave" disabled={!adminTarget || busy} onClick={() => adminTarget && void chooseFor(adminTarget, "leave")}>
                    <X size={13} /> {isThai ? "ลา" : "Leave"}
                  </button>
                </div>
              </div>
            )}

            <div className="event-roster">
              {(
                [
                  ["joined", joinedOf(selectedRows), isThai ? "ลงเล่น" : "PLAYING", <Users size={11} />],
                  ["waitlisted", waitlistOf(selectedRows), isThai ? "คิวสำรอง" : "WAITLIST", <Users size={11} />],
                  ["leave", leaveOf(selectedRows), isThai ? "ลา" : "ON LEAVE", <X size={11} />],
                ] as const
              ).map(([status, people, title, icon]) => {
                if (status === "waitlisted" && people.length === 0) return null;
                return (
                  <div key={status} data-roster={status}>
                    <span className="eyebrow">
                      {icon} {title} ({people.length})
                    </span>
                    {people.length === 0 ? (
                      <p>—</p>
                    ) : (
                      <div className="roster-people">
                        {people.map((r) => (
                          <span className={`person ${status}`} key={r.memberId}>
                            {status === "waitlisted" && <b>#{r.waitlistPos}</b>} {ignOf(r.memberId)}
                            {placementLabel(r, isThai) && <small> · {placementLabel(r, isThai)}</small>}
                            {(isAdmin || (r.memberId === memberId && !cantChange)) && (
                              <button type="button" disabled={busy} onClick={() => void chooseFor(r.memberId, null)} aria-label={isThai ? `ล้าง ${ignOf(r.memberId)}` : `Clear ${ignOf(r.memberId)}`}>
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

import type { Registration, RegistrationBook, SetRegistrationResult } from "../api";
import { messageForCode } from "../api";
import { attendanceKey } from "../data/guild";

/** Pure helpers for the weekly schedule (kept out of the component so they can be unit-tested). */

export const rowsOf = (book: RegistrationBook | null, dateKey: string, eventId: string): Registration[] =>
  book?.[attendanceKey(dateKey, eventId)] ?? [];

export const joinedOf = (rows: Registration[]) => rows.filter((r) => r.status === "joined");
export const waitlistOf = (rows: Registration[]) =>
  rows.filter((r) => r.status === "waitlisted").sort((a, b) => (a.waitlistPos ?? 0) - (b.waitlistPos ?? 0));
export const leaveOf = (rows: Registration[]) => rows.filter((r) => r.status === "leave");

/** How a joined member is shown on a planner activity: "Placed" or "Reserve #n". */
export function placementLabel(row: Registration, isThai: boolean): string | null {
  if (row.status !== "joined" || row.placed === undefined) return null; // not a planner activity
  if (row.placed) return isThai ? "จัดทีมแล้ว" : "Placed";
  return isThai ? `สำรอง #${row.reserveOrder ?? "?"}` : `Reserve #${row.reserveOrder ?? "?"}`;
}

/** "Playing", "Waitlist #2", "On leave" ... for the signed-in member's own row. */
export function statusText(row: Registration | undefined, isThai: boolean): string {
  if (!row) return isThai ? "ยังไม่เลือก" : "Not set";
  if (row.status === "joined") {
    const place = placementLabel(row, isThai);
    return (isThai ? "ลงเล่น" : "Playing") + (place ? ` · ${place}` : "");
  }
  if (row.status === "waitlisted") return isThai ? `รอคิว #${row.waitlistPos ?? "?"}` : `Waitlist #${row.waitlistPos ?? "?"}`;
  return isThai ? "ลา" : "On leave";
}

type Names = (memberId: string) => string;

/** Notices after a successful write: what happened to me, and to anyone else who moved because of it. */
export function writeNotices(
  result: SetRegistrationResult,
  ctx: { me: string; target: string; isThai: boolean; ignOf: Names },
): string[] {
  const { me, target, isThai, ignOf } = ctx;
  const t = (en: string, th: string) => (isThai ? th : en);
  const who = target === me ? t("You", "คุณ") : ignOf(target);
  const out: string[] = [];
  if (result.status === "waitlisted") {
    out.push(
      target === me
        ? t(`The activity is full: you are on the waitlist at #${result.waitlistPosition}.`, `กิจกรรมเต็ม: คุณอยู่ในคิวสำรองลำดับที่ ${result.waitlistPosition}`)
        : t(`The activity is full: ${who} is on the waitlist at #${result.waitlistPosition}.`, `กิจกรรมเต็ม: ${who} อยู่ในคิวสำรองลำดับที่ ${result.waitlistPosition}`),
    );
  } else if (result.status === "joined") {
    out.push(t(`${who} registered as playing.`, `${who}ลงทะเบียนเล่นแล้ว`));
  } else if (result.status === "leave") {
    out.push(t(`${who} marked as on leave.`, `บันทึกว่า${who}ลาแล้ว`));
  } else {
    out.push(t(`${who} cleared the registration.`, `ล้างการลงทะเบียนของ${who}แล้ว`));
  }
  for (const id of result.promoted) {
    out.push(id === me ? t("You were moved up from the waitlist.", "คุณได้เลื่อนขึ้นจากคิวสำรองแล้ว") : t(`${ignOf(id)} was moved up from the waitlist.`, `${ignOf(id)} ได้เลื่อนขึ้นจากคิวสำรอง`));
  }
  for (const b of result.backfilled) {
    if (b.vacatedMemberId === me) {
      out.push(t(`Your slot in ${b.teamName} was given to ${ignOf(b.promotedMemberId)}.`, `ช่องของคุณในทีม ${b.teamName} ถูกมอบให้ ${ignOf(b.promotedMemberId)}`));
    } else if (b.promotedMemberId === me) {
      out.push(t(`You moved from reserve to placed in ${b.teamName}.`, `คุณย้ายจากสำรองเข้าทีม ${b.teamName} แล้ว`));
    } else {
      out.push(t(`${ignOf(b.promotedMemberId)} moved from reserve to ${b.teamName} (slot ${b.slot}).`, `${ignOf(b.promotedMemberId)} ย้ายจากสำรองเข้าทีม ${b.teamName} (ช่อง ${b.slot})`));
    }
  }
  return out;
}

/** Notices for changes to MY registrations that someone else caused (seen when the roster is refreshed). */
export function myChangeNotices(
  before: RegistrationBook,
  after: RegistrationBook,
  me: string,
  isThai: boolean,
  nameOf: (key: string) => string,
): string[] {
  const out: string[] = [];
  for (const key of Object.keys(after)) {
    const was = before[key]?.find((r) => r.memberId === me);
    const now = after[key]?.find((r) => r.memberId === me);
    if (!was || !now) continue;
    const name = nameOf(key);
    if (was.status === "waitlisted" && now.status === "joined") {
      out.push(isThai ? `คุณได้เลื่อนขึ้นจากคิวสำรองใน ${name}` : `You were moved up from the waitlist for ${name}.`);
    } else if (was.status === "joined" && was.placed === false && now.status === "joined" && now.placed === true) {
      out.push(isThai ? `คุณย้ายจากสำรองเข้าทีมแล้วใน ${name}` : `You moved from reserve to placed for ${name}.`);
    } else if (was.status === "joined" && was.placed === true && now.status === "joined" && now.placed === false) {
      out.push(isThai ? `ช่องของคุณใน ${name} ถูกย้าย คุณอยู่ในรายชื่อสำรอง` : `Your slot for ${name} was changed: you are now a reserve.`);
    }
  }
  return out;
}

export { messageForCode };

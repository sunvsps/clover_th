import { ApiError } from "./client";

const messages: Record<string, [th: string, en: string]> = {
  AUTH_REQUIRED: ["กรุณาเข้าสู่ระบบก่อน", "Please sign in first."],
  AUTH_NOT_REGISTERED: ["บัญชี Discord นี้ยังไม่ได้ลงทะเบียนกับบอทกิลด์", "This Discord account is not registered with the guild bot."],
  AUTH_MEMBER_INACTIVE: ["บัญชีนี้ถูกปิดใช้งาน", "This member account is deactivated."],
  AUTH_OAUTH_FAILED: ["เข้าสู่ระบบด้วย Discord ไม่สำเร็จ ลองใหม่อีกครั้ง", "Discord sign-in failed. Please try again."],
  ADMIN_REQUIRED: ["ต้องเป็นแอดมินเท่านั้น", "Admins only."],
  FORBIDDEN_OTHER_MEMBER: ["แก้ไขข้อมูลของคนอื่นไม่ได้", "You cannot change another member."],
  DUPLICATE_IGN: ["ชื่อในเกมนี้มีคนใช้แล้ว", "That in-game name is already taken."],
  DUPLICATE_JOB_LABEL: ["ชื่ออาชีพซ้ำ", "Duplicate job name."],
  JOB_IN_USE: ["ลบไม่ได้ ยังมีสมาชิกใช้อาชีพนี้", "Cannot delete: members still use this job."],
  VALIDATION_ERROR: ["ข้อมูลไม่ถูกต้อง", "Invalid input."],
  MEMBER_INACTIVE: ["สมาชิกคนนี้ถูกปิดใช้งาน", "That member is deactivated."],
  INVALID_OCCURRENCE_DATE: ["วันที่ไม่ตรงกับวันของกิจกรรม", "That date does not match the event's weekday."],
  REGISTRATION_CLOSED: ["ปิดลงทะเบียนแล้ว (กิจกรรมเริ่มแล้ว)", "Registration is closed (the activity has started)."],
  ACTIVITY_HAS_NO_PLANNER: ["กิจกรรมนี้ไม่มีการจัดทีม", "This activity has no team planner."],
  PLAN_VERSION_CONFLICT: ["มีคนแก้แผนนี้ก่อนหน้า โหลดข้อมูลล่าสุดแล้ว ลองอีกครั้ง", "Someone changed this plan first. Reloaded the latest version — try again."],
  TEAM_FULL: ["ทีมนี้เต็มแล้ว", "That team is full."],
  SLOT_TAKEN: ["ช่องนี้มีคนอยู่แล้ว", "That slot is taken."],
  PLAN_NOT_EMPTY: ["แผนนี้มีคนอยู่แล้ว ต้องล้างก่อนคัดลอก", "The plan is not empty — clear it before copying."],
  LAYOUT_BELOW_PLACED: ["ลด layout ไม่ได้ เพราะมีสมาชิกอยู่ในทีม/ช่องที่จะหาย", "Cannot shrink the layout: members are placed in teams or slots that would disappear."],
  NOT_AN_AUTO_BACKFILL: ["ช่องนี้ไม่ได้มาจากการเลื่อนตัวสำรองอัตโนมัติ", "This placement was not an automatic backfill."],
  ROUND_NOT_OPEN: ["รอบนี้ยังไม่เปิด", "This round is not open."],
  ROUND_CLOSED: ["รอบนี้ปิดแล้ว", "This round has closed."],
  ROUND_NOT_DRAFT: ["ทำได้เฉพาะรอบที่เป็นแบบร่าง", "Only draft rounds can be edited."],
  ROUND_EMPTY: ["รอบนี้ยังไม่มีไอเท็ม", "This round has no items."],
  ANOTHER_ROUND_OPEN: ["มีรอบประเภทเดียวกันเปิดอยู่แล้ว ปิดรอบนั้นก่อน", "Another round of this type is already open — close it first."],
  ITEM_ALREADY_CLAIMED: ["ช้าไป มีคนกดก่อนแล้ว", "Too late — someone claimed it first."],
  CLAIM_CAP_REACHED: ["จองครบจำนวนสูงสุดแล้ว ยกเลิกชิ้นอื่นก่อน", "You have reached the claim cap — release one first."],
  NOT_YOUR_CLAIM: ["นี่ไม่ใช่การจองของคุณ", "That is not your claim."],
  NOT_ELIGIBLE_FOR_CATEGORY: ["คุณไม่ได้อยู่ในคิวหมวดนี้ตอนที่รอบเริ่ม", "You were not in this category's queue when the round started."],
  INVALID_PREFERENCE_LIST: ["รายการความต้องการไม่ถูกต้อง", "Invalid preference list."],
  RATE_LIMITED: ["กดถี่เกินไป รอสักครู่", "Too many requests — slow down a little."],
  CSRF_REJECTED: ["คำขอถูกปฏิเสธ (ความปลอดภัย) โหลดหน้าใหม่แล้วลองอีกครั้ง", "Request rejected (security check). Reload and try again."],
  SERVICE_BUSY: ["ระบบกำลังยุ่ง ลองใหม่อีกครั้ง", "The service is busy — try again."],
  DB_UNAVAILABLE: ["เชื่อมต่อฐานข้อมูลไม่ได้", "Database unavailable."],
  CANNOT_DEACTIVATE_SELF: ["ปิดใช้งานบัญชีตัวเองไม่ได้", "You cannot deactivate yourself."],
  NOTIFICATION_NOT_RETRYABLE: ["ข้อความนี้ส่งสำเร็จแล้ว", "That notification was already sent."],
  NOT_FOUND: ["ไม่พบข้อมูล", "Not found."],
  HTTP_ERROR: ["เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "Could not reach the server."],
};

export function describeError(error: unknown, isThai: boolean): string {
  if (error instanceof ApiError) {
    const entry = messages[error.code];
    if (entry) return isThai ? entry[0] : entry[1];
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof TypeError) return isThai ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" : "Could not reach the server.";
  return error instanceof Error ? error.message : String(error);
}

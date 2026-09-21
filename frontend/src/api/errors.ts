/**
 * Stable API error codes -> user-facing messages (English and Thai). The backend returns
 * `{ error: { code, message, details } }`; the frontend translates by `code` (design 6, 10). `message` from the server
 * is only an English fallback for codes not listed here.
 */
type Text = { en: string; th: string };

const messages: Record<string, Text> = {
  AUTH_REQUIRED: { en: "Please sign in.", th: "กรุณาเข้าสู่ระบบ" },
  AUTH_NOT_REGISTERED: {
    en: "Your Discord account is not registered with the guild yet. Ask an admin to register you through the Discord bot.",
    th: "บัญชี Discord ของคุณยังไม่ได้ลงทะเบียนกับกิลด์ กรุณาให้แอดมินลงทะเบียนผ่านบอท Discord",
  },
  AUTH_MEMBER_INACTIVE: {
    en: "Your guild membership is deactivated. Contact an admin if this is a mistake.",
    th: "สมาชิกภาพของคุณถูกปิดใช้งาน หากเกิดจากความผิดพลาดกรุณาติดต่อแอดมิน",
  },
  AUTH_STATE_INVALID: {
    en: "The sign-in link expired or was already used. Please try signing in again.",
    th: "ลิงก์เข้าสู่ระบบหมดอายุหรือถูกใช้ไปแล้ว กรุณาลองเข้าสู่ระบบอีกครั้ง",
  },
  AUTH_OAUTH_FAILED: {
    en: "Discord sign-in did not complete. Please try again.",
    th: "การเข้าสู่ระบบด้วย Discord ไม่สำเร็จ กรุณาลองอีกครั้ง",
  },
  ADMIN_REQUIRED: { en: "Only admins can do this.", th: "เฉพาะแอดมินเท่านั้น" },
  FORBIDDEN_OTHER_MEMBER: { en: "You can only change your own status.", th: "คุณเปลี่ยนได้เฉพาะสถานะของตัวเอง" },
  CSRF_REJECTED: { en: "The request was rejected. Reload the page and try again.", th: "คำขอถูกปฏิเสธ กรุณารีโหลดหน้าแล้วลองอีกครั้ง" },
  INVALID_JOB: { en: "That job does not exist.", th: "ไม่มีอาชีพนี้" },
  DUPLICATE_IGN: { en: "That in-game name is already used by another member.", th: "ชื่อในเกมนี้มีสมาชิกใช้อยู่แล้ว" },
  DUPLICATE_JOB_LABEL: { en: "A job with that name already exists.", th: "มีอาชีพชื่อนี้อยู่แล้ว" },
  JOB_IN_USE: { en: "That job is still used by members and cannot be deleted.", th: "ยังมีสมาชิกใช้อาชีพนี้ จึงลบไม่ได้" },
  VALIDATION_ERROR: { en: "Some of the information is not valid.", th: "ข้อมูลบางส่วนไม่ถูกต้อง" },
  MEMBER_NOT_FOUND: { en: "Member not found.", th: "ไม่พบสมาชิก" },
  NOT_FOUND: { en: "Not found.", th: "ไม่พบข้อมูล" },
  MEMBER_INACTIVE: { en: "That member is deactivated.", th: "สมาชิกคนนี้ถูกปิดใช้งาน" },
  CANNOT_DEACTIVATE_SELF: { en: "You cannot deactivate your own account.", th: "คุณไม่สามารถปิดใช้งานบัญชีของตัวเองได้" },
  INVALID_OCCURRENCE_DATE: { en: "That date is not valid for this activity.", th: "วันที่นี้ไม่ตรงกับกิจกรรม" },
  REGISTRATION_CLOSED: { en: "Registration is closed: the activity has already started.", th: "ปิดลงทะเบียนแล้ว กิจกรรมเริ่มไปแล้ว" },
  ACTIVITY_HAS_NO_PLANNER: { en: "This activity has no team planner.", th: "กิจกรรมนี้ไม่มีการจัดทีม" },
  AUTO_BACKFILL_REQUIRES_PLANNER: { en: "Auto-backfill needs an activity with a planner.", th: "การเติมช่องอัตโนมัติใช้ได้เฉพาะกิจกรรมที่มีการจัดทีม" },
  PLAN_VERSION_CONFLICT: { en: "The plan was changed by someone else. It has been reloaded; please try again.", th: "มีคนอื่นแก้แผนไปแล้ว โหลดใหม่แล้ว กรุณาลองอีกครั้ง" },
  TEAM_FULL: { en: "That team is full.", th: "ทีมนี้เต็มแล้ว" },
  SLOT_TAKEN: { en: "That slot is already taken.", th: "ช่องนี้ถูกใช้แล้ว" },
  SLOT_OUT_OF_RANGE: { en: "That slot does not exist in this team.", th: "ไม่มีช่องนี้ในทีม" },
  PLAN_NOT_EMPTY: { en: "The plan is not empty. Clear it first, then copy.", th: "แผนไม่ว่าง กรุณาล้างก่อนแล้วจึงคัดลอก" },
  SERVICE_BUSY: { en: "The server is busy. Please try again in a moment.", th: "เซิร์ฟเวอร์กำลังยุ่ง กรุณาลองอีกครั้งในอีกสักครู่" },
  TEAM_NOT_IN_ACTIVITY: { en: "That team belongs to another activity.", th: "ทีมนี้เป็นของกิจกรรมอื่น" },
  LAYOUT_BELOW_PLACED: { en: "The layout change would leave placed members without a slot. Move them first.", th: "การเปลี่ยนโครงสร้างจะทำให้บางคนไม่มีช่อง กรุณาย้ายพวกเขาก่อน" },
  NOT_AN_AUTO_BACKFILL: { en: "Only an auto-promoted placement can be undone.", th: "ยกเลิกได้เฉพาะตำแหน่งที่เลื่อนขึ้นอัตโนมัติ" },
  ROUND_NOT_OPEN: { en: "The round is not open yet.", th: "รอบประมูลยังไม่เปิด" },
  ROUND_CLOSED: { en: "The round is closed.", th: "รอบประมูลปิดแล้ว" },
  ROUND_NOT_CLOSED: { en: "Results are available after the round closes.", th: "ดูผลได้หลังปิดรอบ" },
  ROUND_NOT_DRAFT: { en: "Only a draft round can be changed.", th: "แก้ไขได้เฉพาะรอบที่ยังเป็นฉบับร่าง" },
  ROUND_EMPTY: { en: "Add at least one item before starting.", th: "กรุณาเพิ่มไอเท็มอย่างน้อยหนึ่งชิ้นก่อนเริ่ม" },
  ANOTHER_ROUND_OPEN: { en: "Another round of this type is already open. Close it first.", th: "มีรอบประเภทนี้เปิดอยู่แล้ว กรุณาปิดก่อน" },
  ROUND_TYPE_MISMATCH: { en: "That action does not apply to this kind of round.", th: "การกระทำนี้ใช้กับรอบประเภทนี้ไม่ได้" },
  INVALID_CATEGORY_FOR_TYPE: { en: "A queue round accepts only Gear, Card and Relic items.", th: "รอบคิวรับเฉพาะ Gear, Card และ Relic" },
  ITEM_ALREADY_CLAIMED: { en: "Someone else got this item first.", th: "มีคนจองไอเท็มนี้ไปก่อนแล้ว" },
  CLAIM_CAP_REACHED: { en: "You have reached the claim limit for this round.", th: "คุณจองครบตามจำนวนสูงสุดในรอบนี้แล้ว" },
  NOT_YOUR_CLAIM: { en: "That item is claimed by someone else.", th: "ไอเท็มนี้เป็นของคนอื่น" },
  NOT_ELIGIBLE_FOR_CATEGORY: { en: "You were not in that queue when the round opened.", th: "คุณไม่ได้อยู่ในคิวนี้ตอนเปิดรอบ" },
  INVALID_PREFERENCE_LIST: { en: "Your list contains an invalid item.", th: "รายการของคุณมีไอเท็มที่ไม่ถูกต้อง" },
  INVALID_QUEUE_CATEGORY: { en: "Queues exist for Gear, Card and Relic only.", th: "มีคิวเฉพาะ Gear, Card และ Relic" },
  NOTIFICATION_NOT_RETRYABLE: { en: "That notification cannot be retried.", th: "ส่งการแจ้งเตือนนี้ซ้ำไม่ได้" },
  RATE_LIMITED: { en: "Too many requests. Please slow down.", th: "คำขอมากเกินไป กรุณารอสักครู่" },
  BAD_REQUEST: { en: "The request was not understood.", th: "ไม่สามารถประมวลผลคำขอได้" },
  CONFLICT: { en: "That conflicts with existing data.", th: "ข้อมูลซ้ำกับที่มีอยู่" },
  REFERENCE_CONFLICT: { en: "That is still referenced elsewhere.", th: "ยังถูกใช้งานอยู่ที่อื่น" },
  INTERNAL_ERROR: { en: "Something went wrong on the server.", th: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์" },
  DB_UNAVAILABLE: { en: "The service is temporarily unavailable.", th: "ระบบไม่พร้อมใช้งานชั่วคราว" },
  NETWORK_ERROR: { en: "Cannot reach the server. Check your connection.", th: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต" },
  INVALID_RESPONSE: { en: "The server sent an unexpected response.", th: "เซิร์ฟเวอร์ตอบกลับในรูปแบบที่ไม่คาดคิด" },
  SESSION_EXPIRED: { en: "Your session expired. Please sign in again.", th: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง" },
};

const fallback: Text = { en: "Something went wrong. Please try again.", th: "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง" };

export function messageForCode(code: string, isThai: boolean, serverMessage?: string): string {
  const entry = messages[code];
  if (entry) return isThai ? entry.th : entry.en;
  return isThai ? fallback.th : serverMessage || fallback.en;
}

export const knownErrorCodes = Object.keys(messages);

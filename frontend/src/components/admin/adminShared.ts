import { isApiError } from "../../api";

/** Text for a failed admin call: the translated code (ADMIN_REQUIRED, DUPLICATE_IGN, ...) or a generic message. */
export const adminErrorText = (err: unknown, isThai: boolean) =>
  isApiError(err) ? err.userMessage(isThai) : isThai ? "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง" : "Something went wrong. Please try again.";

const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-09-22 17:05" in Bangkok time for an ISO instant (Bangkok is UTC+7 all year). */
export function bangkokStamp(iso: string): string {
  const d = new Date(Date.parse(iso) + 7 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export const isHttpsUrl = (value: string) => /^https:\/\//i.test(value) && URL.canParse(value) && !new URL(value).username && !new URL(value).password;

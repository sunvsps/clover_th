import { Hash } from "lucide-react";
import { messageForCode } from "../api";
import type { Session } from "../hooks/useSession";

type Props = { session: Session; isThai: boolean };

const titles = {
  AUTH_NOT_REGISTERED: { en: "Not registered", th: "ยังไม่ได้ลงทะเบียน" },
  AUTH_MEMBER_INACTIVE: { en: "Membership deactivated", th: "สมาชิกภาพถูกปิดใช้งาน" },
  AUTH_STATE_INVALID: { en: "Sign-in link expired", th: "ลิงก์เข้าสู่ระบบหมดอายุ" },
  AUTH_OAUTH_FAILED: { en: "Sign-in did not complete", th: "เข้าสู่ระบบไม่สำเร็จ" },
} as const;

/** What the page shows instead of the tools while there is no signed-in member (each auth failure has its own screen). */
export default function AuthScreens({ session, isThai }: Props) {
  const { state } = session;
  const t = (en: string, th: string) => (isThai ? th : en);

  if (state.status === "loading") {
    return (
      <section className="auth-screen" role="status" aria-live="polite">
        <p>{t("Loading…", "กำลังโหลด…")}</p>
      </section>
    );
  }

  if (state.status === "authError") {
    return (
      <section className="auth-screen" data-auth-screen={state.code} role="alert">
        <h1>{isThai ? titles[state.code].th : titles[state.code].en}</h1>
        <p>{messageForCode(state.code, isThai)}</p>
        {state.code === "AUTH_STATE_INVALID" || state.code === "AUTH_OAUTH_FAILED" ? (
          <button className="top-login-button" type="button" onClick={session.signIn}>
            <Hash size={15} /> {t("Try again with Discord", "ลองเข้าสู่ระบบด้วย Discord อีกครั้ง")}
          </button>
        ) : (
          <button type="button" onClick={session.dismissAuthError}>
            {t("Back", "กลับ")}
          </button>
        )}
      </section>
    );
  }

  if (state.status === "expired") {
    return (
      <section className="auth-screen" data-auth-screen="SESSION_EXPIRED" role="alert">
        <h1>{t("Session expired", "เซสชันหมดอายุ")}</h1>
        <p>{messageForCode("SESSION_EXPIRED", isThai)}</p>
        <button className="top-login-button" type="button" onClick={session.signIn}>
          <Hash size={15} /> {t("Sign in with Discord", "เข้าสู่ระบบด้วย Discord")}
        </button>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="auth-screen" role="alert">
        <h1>{t("Cannot load your account", "โหลดข้อมูลบัญชีไม่ได้")}</h1>
        <p>{messageForCode(state.error?.code ?? "NETWORK_ERROR", isThai, state.error?.message)}</p>
        <button type="button" onClick={() => void session.retry()}>
          {t("Retry", "ลองอีกครั้ง")}
        </button>
      </section>
    );
  }

  return (
    <section className="auth-screen" data-auth-screen="SIGNED_OUT">
      <h1>{t("Clover guild tools", "เครื่องมือกิลด์ Clover")}</h1>
      <p>{t("Sign in with your Discord account to see the schedule, the team planner and the item board.", "เข้าสู่ระบบด้วยบัญชี Discord เพื่อดูตารางกิจกรรม จัดทีม และกระดานไอเท็ม")}</p>
      <button className="top-login-button" type="button" onClick={session.signIn}>
        <Hash size={15} /> {t("Sign in with Discord", "เข้าสู่ระบบด้วย Discord")}
      </button>
    </section>
  );
}

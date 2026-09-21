import { useEffect, useState } from "react";
import { demoLogin, getDemoMembers, isApiError, type DemoMember } from "../api";

type Props = { isThai: boolean; onSignedIn: () => void };

/**
 * "Demo login (local only)": shown on the signed-out screen ONLY when the backend answers GET /api/v1/demo/members with
 * 200 (it does so only with LOCAL_DEMO_ENABLED=true, for this machine). On a 404 (the normal case) it renders nothing.
 */
export default function DemoLogin({ isThai, onSignedIn }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const [members, setMembers] = useState<DemoMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDemoMembers().then(
      (list) => !cancelled && setMembers(list),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!members) return null;

  async function signIn(m: DemoMember) {
    setBusy(true);
    setError(null);
    try {
      await demoLogin(m.discordId);
      onSignedIn();
    } catch (err) {
      setError(isApiError(err) ? err.userMessage(isThai) : t("Something went wrong. Please try again.", "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง"));
      setBusy(false);
    }
  }

  return (
    <section className="demo-login" aria-label={t("Demo login (local only)", "เข้าสู่ระบบสาธิต (เฉพาะเครื่องนี้)")}>
      <h2>{t("Demo login (local only)", "เข้าสู่ระบบสาธิต (เฉพาะเครื่องนี้)")}</h2>
      <p>{t("Pick a member to sign in as. This is for local demos: the server offers it only on this machine, and only when LOCAL_DEMO_ENABLED=true.", "เลือกสมาชิกเพื่อเข้าสู่ระบบ ใช้สำหรับสาธิตในเครื่องนี้เท่านั้น เซิร์ฟเวอร์เปิดให้เฉพาะเครื่องนี้ และเมื่อตั้งค่า LOCAL_DEMO_ENABLED=true")}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul>
        {members.map((m) => (
          <li key={m.memberId}>
            <span>
              {m.ign}
              {m.isAdmin && <span className="badge admin-badge"> · {t("Admin", "แอดมิน")}</span>}
            </span>
            <button type="button" className="admin-button" disabled={busy} onClick={() => void signIn(m)} aria-label={t(`Sign in as ${m.ign}`, `เข้าสู่ระบบเป็น ${m.ign}`)}>
              {t("Sign in", "เข้าสู่ระบบ")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

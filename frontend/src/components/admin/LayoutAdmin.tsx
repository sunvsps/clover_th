import { useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { ApiError, getLayout, layoutViolations, putLayout, type Layout, type WireActivity } from "../../api";
import { adminErrorText } from "./adminShared";

type Props = { isThai: boolean; activities: WireActivity[]; onChanged: () => void; notify: (message: string) => void };

/** Rooms, teams and team sizes of a planner activity. Shrinking a team below its placed members is refused by the server. */
export default function LayoutAdmin({ isThai, activities, onChanged, notify }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const planners = activities.filter((a) => a.hasPlanner);
  const [activityId, setActivityId] = useState(planners[0]?.id ?? "");
  const [layout, setLayout] = useState<Layout | null>(null);
  const [loaded, setLoaded] = useState<Layout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activityId) return;
    let cancelled = false;
    getLayout(activityId).then(
      (l) => !cancelled && (setLayout(l), setLoaded(l), setError(null)),
      (err) => !cancelled && setError(adminErrorText(err, isThai)),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId]);

  const teamName = (id: number) => loaded?.rooms.flatMap((r) => r.teams).find((tm) => tm.id === id)?.name ?? `#${id}`;
  const total = layout?.rooms.reduce((n, r) => n + r.teams.reduce((m, tm) => m + tm.size, 0), 0) ?? 0;
  const problems: string[] = [];
  if (layout) {
    if (layout.rooms.some((r) => !r.name.trim() || !/^[a-z0-9_-]{1,32}$/.test(r.key))) problems.push(t("Every room needs a name and a key (a-z, 0-9, _ or -).", "ทุกห้องต้องมีชื่อและคีย์ (a-z, 0-9, _ หรือ -)"));
    if (new Set(layout.rooms.map((r) => r.key)).size !== layout.rooms.length) problems.push(t("Room keys must be different.", "คีย์ของห้องต้องไม่ซ้ำ"));
    if (layout.rooms.some((r) => r.teams.some((tm) => !tm.name.trim() || !Number.isInteger(tm.size) || tm.size < 1 || tm.size > 50))) problems.push(t("Every team needs a name and a size from 1 to 50.", "ทุกทีมต้องมีชื่อและขนาด 1 ถึง 50"));
  }

  const setRoom = (i: number, p: Partial<Layout["rooms"][number]>) => setLayout((l) => l && { rooms: l.rooms.map((r, n) => (n === i ? { ...r, ...p } : r)) });
  const setTeam = (i: number, j: number, p: Partial<Layout["rooms"][number]["teams"][number]>) => setLayout((l) => l && { rooms: l.rooms.map((r, n) => (n === i ? { ...r, teams: r.teams.map((tm, k) => (k === j ? { ...tm, ...p } : tm)) } : r)) });

  async function save() {
    if (!layout) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await putLayout(activityId, layout);
      setLayout(saved);
      setLoaded(saved);
      notify(t("Layout saved.", "บันทึกผังทีมแล้ว"));
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === "LAYOUT_BELOW_PLACED") {
        const parts = layoutViolations(err.details).map((v) => t(`${teamName(v.teamId)} still has a member in slot ${v.placed} but its new size is ${v.size}`, `${teamName(v.teamId)} ยังมีสมาชิกในช่อง ${v.placed} แต่ขนาดใหม่คือ ${v.size}`));
        setError(t(`The change would leave placed members without a slot: ${parts.join("; ")}. Move them first.`, `การเปลี่ยนนี้จะทำให้สมาชิกที่จัดทีมไว้ไม่มีช่อง: ${parts.join("; ")} กรุณาย้ายพวกเขาก่อน`));
      } else setError(adminErrorText(err, isThai));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-section" data-admin="layout">
      <div className="admin-toolbar">
        <label>
          <span className="field-label">{t("Activity", "กิจกรรม")}</span>
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)} aria-label={t("Activity", "กิจกรรม")}>
            {planners.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {layout && <span className="occurrence-meta">{total} {t("slots total", "ช่องรวม")}</span>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="layout-rooms">
        {layout?.rooms.map((room, i) => (
          <div className="team-column" key={room.id ?? `new-${i}`} data-layout-room={room.name}>
            <h3>
              <input className="small-input room-name" value={room.name} maxLength={64} onChange={(e) => setRoom(i, { name: e.target.value })} aria-label={t(`Room ${i + 1} name`, `ชื่อห้อง ${i + 1}`)} />
              <input className="small-input" value={room.key} maxLength={32} disabled={room.id !== undefined} title={t("Room key", "คีย์ห้อง")} onChange={(e) => setRoom(i, { key: e.target.value })} aria-label={t(`Room ${i + 1} key`, `คีย์ห้อง ${i + 1}`)} />
              <button type="button" className="chip-tool remove" title={t("Remove room", "ลบห้อง")} aria-label={t(`Remove room ${i + 1}`, `ลบห้อง ${i + 1}`)} onClick={() => setLayout((l) => l && { rooms: l.rooms.filter((_, n) => n !== i) })}><Trash2 size={11} /></button>
              <small>
                {room.teams.length} {t("teams", "ทีม")} · {room.teams.reduce((n, tm) => n + tm.size, 0)} {t("slots", "ช่อง")}
              </small>
            </h3>
            <ul className="layout-teams">
              {room.teams.map((tm, j) => (
                <li key={tm.id ?? `t-${j}`}>
                  <input className="small-input" value={tm.name} maxLength={64} onChange={(e) => setTeam(i, j, { name: e.target.value })} aria-label={t(`${room.name} team ${j + 1} name`, `ชื่อทีม ${j + 1} ของ ${room.name}`)} />
                  <input className="small-input tiny" type="number" min={1} max={50} value={tm.size} onChange={(e) => setTeam(i, j, { size: Number(e.target.value) })} aria-label={t(`${room.name} team ${j + 1} size`, `ขนาดทีม ${j + 1} ของ ${room.name}`)} />
                  <button type="button" className="chip-tool remove" aria-label={t(`Remove team ${j + 1} of ${room.name}`, `ลบทีม ${j + 1} ของ ${room.name}`)} onClick={() => setRoom(i, { teams: room.teams.filter((_, k) => k !== j) })}><X size={11} /></button>
                </li>
              ))}
            </ul>
            <div className="layout-room-actions">
              <button type="button" className="copy-button" onClick={() => setRoom(i, { teams: [...room.teams, { name: `${t("Team", "ทีม")} ${room.teams.length + 1}`, size: 5 }] })}><Plus size={12} /> {t("Add team", "เพิ่มทีม")}</button>
            </div>
          </div>
        ))}
      </div>
      {layout && (
        <div className="editor-actions">
          {problems.map((p) => <span className="form-error" key={p}>{p}</span>)}
          <button type="button" className="copy-button" onClick={() => setLayout((l) => l && { rooms: [...l.rooms, { key: `room-${l.rooms.length + 1}`, name: `${t("Room", "ห้อง")} ${l.rooms.length + 1}`, teams: [{ name: `${t("Team", "ทีม")} 1`, size: 5 }] }] })}><Plus size={12} /> {t("Add room", "เพิ่มห้อง")}</button>
          <button type="button" className="admin-button" disabled={busy || problems.length > 0} onClick={() => void save()}><Check size={13} /> {t("Save layout", "บันทึกผัง")}</button>
        </div>
      )}
    </div>
  );
}

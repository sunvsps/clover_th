import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Plus, Search, Trash2, Users2, X } from "lucide-react";
import { findJob, jobStyle } from "../data/guild";
import { formatCp, normalizeIgn, useGearScores } from "../lib/gearScores";
import { KNOWN_PARTIES_TEXT, parsePartyBlocks, resolvePartyBlocks, useParties } from "../lib/parties";
import type { ViewProps } from "../lib/types";

type Props = Pick<ViewProps, "isThai" | "data" | "notify"> & { onClose: () => void };

const DRAG_KEY = "text/party-member";

export default function PartyBoard({ isThai, data, notify, onClose }: Props) {
  const { parties, partyOf, moveMember, setPartyMembers, addSlot, clear, hasAny } = useParties();
  const { scoreOf } = useGearScores();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);

  // Pre-fill the board once from the guild's known regular parties, skipping a name already claimed by an earlier group.
  useEffect(() => {
    if (hasAny) return;
    const resolved = resolvePartyBlocks(parsePartyBlocks(KNOWN_PARTIES_TEXT), data.members);
    const used = new Set<string>();
    resolved.forEach((igns, index) => {
      const slotId = parties[index]?.id;
      if (!slotId) return;
      const uniqueIgns = igns.map(normalizeIgn).filter((ign) => !used.has(ign));
      uniqueIgns.forEach((ign) => used.add(ign));
      if (uniqueIgns.length) setPartyMembers(slotId, uniqueIgns);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const memberByIgn = useMemo(() => new Map(data.members.map((member) => [normalizeIgn(member.ign), member])), [data.members]);
  const jobOf = (ign: string) => findJob(data.jobs, memberByIgn.get(ign)?.jobId);
  const query = search.trim().toLowerCase();
  const allUnassigned = data.members.filter((member) => !partyOf(member.ign));
  const visibleUnassigned = allUnassigned.filter((member) => member.ign.toLowerCase().includes(query));

  function startDrag(event: DragEvent<HTMLElement>, ign: string) {
    event.dataTransfer.setData(DRAG_KEY, ign);
    event.dataTransfer.effectAllowed = "move";
    setPicked(null);
  }
  const dragOver = (target: string) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (hoverTarget !== target) setHoverTarget(target);
  };
  const dropTo = (partyId: string | null) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const ign = event.dataTransfer.getData(DRAG_KEY);
    setHoverTarget(null);
    if (ign) moveMember(ign, partyId);
  };
  const tapTarget = (partyId: string | null) => {
    if (!picked) return;
    moveMember(picked, partyId);
    setPicked(null);
  };

  const card = (ign: string) => {
    const member = memberByIgn.get(ign);
    const score = scoreOf(ign);
    return (
      <div
        className={`member-chip editable ${picked === ign ? "picked" : ""}`}
        style={jobStyle(jobOf(ign))}
        key={ign}
        draggable
        onDragStart={(event) => startDrag(event, ign)}
        onClick={(event) => {
          event.stopPropagation();
          setPicked((current) => (current === ign ? null : ign));
        }}
        role="button"
        tabIndex={0}
        title={member?.ign ?? ign}
      >
        <span className="chip-name">{member?.ign ?? ign}</span>
        {score && <small className="chip-cp">{formatCp(score.cp)}</small>}
      </div>
    );
  };

  return (
    <div className="page-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="page-modal party-board" role="dialog" aria-modal="true" aria-labelledby="party-board-title" onClick={(event) => event.stopPropagation()}>
        <div className="page-modal-header">
          <div>
            <p className="eyebrow">
              <Users2 size={11} /> {isThai ? "แอดมิน: ปาร์ตี้ประจำ" : "ADMIN: REGULAR PARTIES"}
            </p>
            <h2 id="party-board-title">{isThai ? "ลากการ์ดเข้ากลุ่มปาร์ตี้" : "Drag cards into party groups"}</h2>
            <small className="event-dialog-status">
              {isThai
                ? "ลากคนจากคลังไปช่องปาร์ตี้ (หรือแตะการ์ดแล้วแตะช่อง) ลากกลับมาที่คลังเพื่อยกเลิก ย้ายได้ตลอดเวลาถ้าปาร์ตี้ประจำเปลี่ยน"
                : "Drag a member from the pool into a party slot (or tap a card, then tap a slot). Drag back to the pool to remove. Move anyone anytime the regular party changes."}
            </small>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {picked && (
          <div className="picked-banner">
            {isThai ? `เลือก ${memberByIgn.get(picked)?.ign ?? picked} แล้ว แตะช่องปาร์ตี้ที่ต้องการ (หรือแตะคลังเพื่อยกเลิกปาร์ตี้)` : `${memberByIgn.get(picked)?.ign ?? picked} selected. Tap a party slot (or the pool to unassign).`}
            <button type="button" onClick={() => setPicked(null)}>
              {isThai ? "ยกเลิก" : "Cancel"}
            </button>
          </div>
        )}

        <div className="party-board-layout">
          <aside className={`member-pool ${hoverTarget === "pool" ? "hover" : ""}`} onDragOver={dragOver("pool")} onDragLeave={() => setHoverTarget((current) => (current === "pool" ? null : current))} onDrop={dropTo(null)} onClick={() => tapTarget(null)}>
            <div className="pool-title">
              <strong>{isThai ? "ยังไม่มีปาร์ตี้" : "Unassigned"}</strong>
              <span>{allUnassigned.length}</span>
            </div>
            <label className="team-search pool-search" onClick={(event) => event.stopPropagation()}>
              <Search size={14} />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isThai ? "ค้นหา..." : "Search..."} />
            </label>
            <div className="party-pool-list">{visibleUnassigned.map((member) => card(normalizeIgn(member.ign)))}</div>
            {visibleUnassigned.length === 0 && <p className="empty-search">{query ? (isThai ? "ไม่พบ" : "No match.") : isThai ? "ทุกคนมีปาร์ตี้แล้ว" : "Everyone has a party."}</p>}
          </aside>

          <div className="party-slot-grid">
            {parties.map((party) => (
              <div
                key={party.id}
                className={`party-slot-card ${hoverTarget === party.id ? "hover" : ""} ${party.memberIgns.length === 0 ? "empty" : ""}`}
                style={{ "--party-color": party.color } as { [key: string]: string }}
                onDragOver={dragOver(party.id)}
                onDragLeave={() => setHoverTarget((current) => (current === party.id ? null : current))}
                onDrop={dropTo(party.id)}
                onClick={() => tapTarget(party.id)}
              >
                <div className="party-slot-title">
                  <span className="party-swatch" style={{ background: party.color }} />
                  <strong>{party.label}</strong>
                  <small>{party.memberIgns.length}</small>
                </div>
                <div className="party-slot-members">
                  {party.memberIgns.map((ign) => card(ign))}
                  {party.memberIgns.length === 0 && <p className="party-slot-empty-hint">{isThai ? "ลากมาวางที่นี่" : "Drop here"}</p>}
                </div>
              </div>
            ))}
            <button type="button" className="party-slot-add" onClick={addSlot}>
              <Plus size={16} /> {isThai ? "เพิ่มปาร์ตี้" : "Add party"}
            </button>
          </div>
        </div>

        <div className="editor-actions">
          <span className="occurrence-meta">{isThai ? `${parties.length} ปาร์ตี้ทั้งหมด` : `${parties.length} parties total`}</span>
          <button
            type="button"
            className="copy-button danger"
            onClick={() => {
              if (window.confirm(isThai ? "ล้างปาร์ตี้ประจำทั้งหมด?" : "Clear all parties?")) {
                clear();
                notify(isThai ? "ล้างปาร์ตี้ประจำแล้ว" : "Parties cleared.");
              }
            }}
          >
            <Trash2 size={13} /> {isThai ? "ลบทั้งหมด" : "Clear all"}
          </button>
          <button type="button" className="copy-button" onClick={onClose}>
            <X size={13} /> {isThai ? "ปิด" : "Close"}
          </button>
        </div>
      </section>
    </div>
  );
}

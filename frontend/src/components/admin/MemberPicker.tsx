import { useId, useState } from "react";
import { Search, X } from "lucide-react";
import { findJob, jobStyle, type GuildMember, type Job } from "../../data/guild";

type Props = {
  members: GuildMember[];
  jobs: Job[];
  /** picked member id, "" for none */
  value: string;
  onChange: (memberId: string) => void;
  isThai: boolean;
  label: string;
};

/**
 * Searchable member picker (ARIA combobox): type to filter by in-game name, pick with a click or the arrow keys and
 * Enter. Each option shows the member's initial and job colour. The picked member shows as a chip that clears on ✕.
 */
export default function MemberPicker({ members, jobs, value, onChange, isThai, label }: Props) {
  const t = (en: string, th: string) => (isThai ? th : en);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const picked = members.find((m) => m.id === value);
  const q = query.trim().toLowerCase();
  const matches = members.filter((m) => !q || m.ign.toLowerCase().includes(q)).slice(0, 50);
  const pick = (m: GuildMember) => {
    onChange(m.id);
    setQuery("");
    setOpen(false);
  };
  const avatar = (m: GuildMember) => (
    <span className="member-pick-avatar" style={jobStyle(findJob(jobs, m.job))} aria-hidden="true">
      {m.ign.charAt(0).toUpperCase()}
    </span>
  );

  if (picked) {
    return (
      <div className="member-pick picked">
        {avatar(picked)}
        <strong>{picked.ign}</strong>
        {findJob(jobs, picked.job) && <span className="job-pill" style={jobStyle(findJob(jobs, picked.job))}>{findJob(jobs, picked.job)!.label}</span>}
        <button type="button" className="chip-tool" onClick={() => onChange("")} aria-label={t(`Clear ${picked.ign}`, `ล้าง ${picked.ign}`)}>
          <X size={11} />
        </button>
      </div>
    );
  }

  return (
    <div className="member-pick">
      <label className="member-pick-input">
        <Search size={13} aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${matches[active]!.id}` : undefined}
          placeholder={t("Search a member…", "ค้นหาสมาชิก…")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && open && matches[active]) {
              e.preventDefault();
              pick(matches[active]!);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </label>
      {open && (
        <ul className="member-pick-list" role="listbox" id={listId}>
          {matches.map((m, i) => {
            const job = findJob(jobs, m.job);
            return (
              <li
                key={m.id}
                id={`${listId}-${m.id}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't close before the click lands
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(m)}
              >
                {avatar(m)}
                <span className="member-pick-name">{m.ign}</span>
                {job && <span className="job-pill" style={jobStyle(job)}>{job.label}</span>}
              </li>
            );
          })}
          {matches.length === 0 && <li className="member-pick-empty">{t("No member matches.", "ไม่พบสมาชิก")}</li>}
        </ul>
      )}
    </div>
  );
}

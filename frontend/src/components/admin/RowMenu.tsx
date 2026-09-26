import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export type RowMenuItem = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean };

/**
 * "⋯" button that opens a small menu of row actions. The menu is position: fixed at the button (so the table's
 * horizontal scroll box doesn't clip it) and closes on a pick, a click outside, Escape, scroll or resize.
 */
export default function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const outside = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && (close(), button.current?.focus());
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  if (items.length === 0) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="row-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={() => {
          if (at) return setAt(null);
          const r = button.current!.getBoundingClientRect();
          setAt({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {at && (
        <div ref={menu} className="row-menu" role="menu" aria-label={label} style={{ top: at.top, right: at.right }}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? "danger" : ""}
              disabled={it.disabled}
              onClick={() => {
                setAt(null);
                it.onSelect();
              }}
            >
              {it.icon} {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

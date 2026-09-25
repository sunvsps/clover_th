import { QUEUE_CATEGORIES, type Category } from "../../api";
import { categoryLabel } from "../../views/auction/auctionModel";
import CategoryPill from "../CategoryPill";

type Props = {
  /** undefined/null = no category yet */
  value: Category | null | undefined;
  isThai: boolean;
  /** accessible name of the group, e.g. "Item 3 category" */
  label: string;
  onChange: (category: Category | undefined) => void;
};

/**
 * An item's category tag followed by three small color dots (Gear, Card, Relic). Clicking a dot picks that category,
 * clicking the picked one again clears it; the dots stay small and outlined so picking one reads as optional.
 */
export default function CategoryDots({ value, isThai, label, onChange }: Props) {
  return (
    <div className="cat-dots-row">
      <CategoryPill category={value ?? null} isThai={isThai} />
      <div className="cat-dots" role="group" aria-label={label}>
        {QUEUE_CATEGORIES.map((c) => {
          const picked = value === c;
          return (
            <button
              type="button"
              key={c}
              className={`cat-dot-btn cat-${c} ${picked ? "active" : ""}`}
              aria-pressed={picked}
              aria-label={categoryLabel(c, isThai)}
              title={categoryLabel(c, isThai)}
              onClick={() => onChange(picked ? undefined : c)}
            />
          );
        })}
      </div>
    </div>
  );
}

import type { Category } from "../api";
import { categoryLabel } from "../views/auction/auctionModel";
import { CATEGORY_ICONS as TINTED } from "./categoryStyle";

/** The item's category as a small tinted tag with an icon, so it doesn't rely on color alone; `null` (untagged) is a
 * dashed "No category" tag. */
export default function CategoryPill({ category, isThai }: { category: Category | null; isThai: boolean }) {
  if (category === null) return <span className="cat-pill none">{categoryLabel(null, isThai)}</span>;
  const Icon = TINTED[category];
  return (
    <span className={`cat-pill ${Icon ? `cat-${category}` : ""}`}>
      {Icon && <Icon size={11} aria-hidden="true" />} {categoryLabel(category, isThai)}
    </span>
  );
}

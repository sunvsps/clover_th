import { Gem, IdCard, Sword } from "lucide-react";
import type { Category } from "../api";
import { categoryLabel } from "../views/auction/auctionModel";

/** Gear, Card and Relic have their own color (red, purple, orange); every other category stays neutral. */
const TINTED: Partial<Record<Category, typeof Sword>> = { gear: Sword, card: IdCard, relic: Gem };

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

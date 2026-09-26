import { Gem, IdCard, Sword } from "lucide-react";
import type { Category } from "../api";

/** Icon of each colored category (Gear sword, Card id card, Relic gem), so a category never relies on color alone. */
export const CATEGORY_ICONS: Partial<Record<Category, typeof Sword>> = { gear: Sword, card: IdCard, relic: Gem };

/** Gear, Card and Relic have their own color (red, purple, orange; see `.cat-*` in features.css). */
export const TINTED_CATEGORIES: Category[] = ["gear", "card", "relic"];

/** Class for an item card's colored left stripe: `cat-stripe` plus `cat-{category}` for Gear/Card/Relic; an untagged item
 * (no category) or any other category gets the neutral gray stripe. */
export const categoryStripe = (category: Category | null | undefined) => `cat-stripe${category && TINTED_CATEGORIES.includes(category) ? ` cat-${category}` : ""}`;

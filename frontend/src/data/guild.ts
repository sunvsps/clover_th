import type { CSSProperties } from "react";
import type { ItemCategory, Job, QueueCategory } from "../api";

const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
export const luminance = (hex: string) => {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.padEnd(6, "0");
  const [r, g, b] = [0, 2, 4].map((offset) => channel(parseInt(full.slice(offset, offset + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Dark ink on mid/light colours, light ink on deep ones — keeps card text readable for any admin-picked colour. */
export const inkFor = (hex: string) => (luminance(hex) > 0.16 ? "#0f1410" : "#fbfbf7");
export const jobStyle = (job: Pick<Job, "color"> | undefined): CSSProperties =>
  ({ "--job-bg": job?.color ?? "#7c8879", "--job-fg": inkFor(job?.color ?? "#7c8879") }) as CSSProperties;
export const findJob = (jobs: Job[], id: number | undefined) => jobs.find((job) => job.id === id);

export const queueCategories: { id: QueueCategory; label: string; labelTh: string }[] = [
  { id: "GEAR", label: "Gear", labelTh: "Gear (อุปกรณ์)" },
  { id: "CARD", label: "Card", labelTh: "Card (การ์ด)" },
  { id: "RELIC", label: "Relic", labelTh: "Relic (เรลิก)" },
];
export const itemCategories: ItemCategory[] = ["GEAR", "CARD", "RELIC", "PET", "MATERIAL", "GEMBOX"];
export const categoryLabel = (category: string, isThai: boolean) => {
  const queue = queueCategories.find((entry) => entry.id === category);
  if (queue) return isThai ? queue.labelTh : queue.label;
  const labels: Record<string, [string, string]> = { PET: ["Pet (สัตว์เลี้ยง)", "Pet"], MATERIAL: ["Material (วัตถุดิบ)", "Material"], GEMBOX: ["Gem Box", "Gem Box"] };
  return labels[category] ? (isThai ? labels[category][0] : labels[category][1]) : category;
};

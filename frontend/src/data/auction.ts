export type Item = {
  id: number;
  name: string;
  rarity: "Rare" | "Epic" | "Legendary";
  status: "available" | "claimed";
  claimedBy?: string;
};

export type Reservation = {
  member: string;
  items: string[];
};

export const items: Item[] = Array.from({ length: 200 }, (_, index) => {
  const number = index + 1;

  return {
    id: number,
    name: `Item ${String(number).padStart(2, "0")}`,
    rarity: number % 7 === 0 ? "Legendary" : number % 3 === 0 ? "Epic" : "Rare",
    status: "available",
  };
});

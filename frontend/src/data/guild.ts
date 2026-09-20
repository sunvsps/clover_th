import type { CSSProperties } from "react";

export type Job = {
  id: number;
  label: string;
  color: string; // hex, admin-editable
};

// Default classes; colours follow the in-game class icons (IMG_2028-2030). Admins can rename, recolour and add more.
export const defaultJobs: Job[] = [
  { id: 1, label: "High Priest", color: "#5cb454" },
  { id: 2, label: "Knight", color: "#e04e4b" },
  { id: 3, label: "Wizard", color: "#3a95e8" },
  { id: 4, label: "Sniper", color: "#e3b53c" },
  { id: 5, label: "Gunslinger", color: "#b8682c" },
  { id: 6, label: "ดรูอิด", color: "#3fb3a1" },
  { id: 7, label: "Assassin", color: "#9a6fdc" },
  { id: 8, label: "Paladin", color: "#bf3f35" },
];

const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
export const luminance = (hex: string) => {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.padEnd(6, "0");
  const [r, g, b] = [0, 2, 4].map((offset) => channel(parseInt(full.slice(offset, offset + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Dark ink on mid/light colours, light ink on deep ones — keeps card text readable for any admin-picked colour. */
export const inkFor = (hex: string) => (luminance(hex) > 0.16 ? "#0f1410" : "#fbfbf7");
export const jobStyle = (job: Job | undefined): CSSProperties =>
  ({ "--job-bg": job?.color ?? "#7c8879", "--job-fg": inkFor(job?.color ?? "#7c8879") }) as CSSProperties;
export const findJob = (jobs: Job[], id: number) => jobs.find((job) => job.id === id);

export type GuildMember = {
  name: string;
  job: number;
  custom?: boolean; // added by an admin from the UI, not from the roster sheet
};

const roster: Record<number, string[]> = {
  1: ["zearthz", "หมัดมังคุด", "ลูกแกะผู้หลงทาง", "ChonYa", "Czz", "Free_Kill", "DuschMill", "Lerp", "JeeNz", "l333l", "ตัวไก่กุ๊กๆ", "Eii3", "Tofus", "แมวกระเป๋า", "lnwสงคราม", "Booooo", "เสีEวค่ะXลวงMา", "Mirabi", "ขนมปังปิ้ง", "น้องแมวส้ม/หมัด", "T A Y"],
  2: ["Mimayu", "Claude", "เฟซssssss", "หมูอบเนย", "ทะลวงรูโบ๋เบ๋", "เบลล์_อาร์", "อารยา", "Desk", "คนหลงทาง", "ThanaKetkaew", "กขคง", "LittelME"],
  3: ["Gantzping", "พยูนไม่ได้ฆ่า", "CoolTM", "V16", "BXNGBXNG", "เสือจ้า", "55XxX55"],
  4: ["มันกะเย", "o0Sudting0o", "น้องดอกบัวตอง", "Kanade", "BeN888", "จิวยี่"],
  5: ["Yiren", "Nuririn", "วานิลาครีมชมพู", "Apori", "Nim", "BTราชามาร", "Thornveil", "Gugora", "HANIRUKA", "-nara-", "Piraru", "มะงึก", "เสือดำ", "-จอมมารบุญ-", "TYESO"],
  6: ["COSMOx", "อาเนียจัง", "Halseyz", "lSephirothl", "Judazz", "SunnylnwZa"],
  7: ["HuM", "HoMies58", "ooMrmrakoo", "หอยขม", "SweetLove"],
  8: ["MaMaMeaw", "Muck", "ตีไปเถอะ", "IAMAHERO"],
};

export const guildMembers: GuildMember[] = defaultJobs.flatMap((job) =>
  roster[job.id].map((name) => ({ name, job: job.id })),
);

export const teamNames = ["A", "B"] as const;
export const SUBTEAMS_PER_TEAM = 8;
export const SUBTEAM_SIZE = 5;

export type Attendance = "joined" | "leave";

/** Attendance is keyed by "<YYYY-MM-DD>:<eventId>" then by member name. */
export const attendanceKey = (dateKey: string, eventId: string) => `${dateKey}:${eventId}`;

export const startOfWeek = (date: Date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
  return start;
};
export const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
export const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const thaiShortMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const formatDay = (date: Date, isThai: boolean) =>
  isThai
    ? `${date.getDate()} ${thaiShortMonths[date.getMonth()]}`
    : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);

export type ScheduleEvent = {
  id: string;
  name: string;
  day: number; // 0 = Monday … 6 = Sunday
  slot: string; // time row it sits in
  start: string;
  end: string;
  guild?: boolean; // hammer icon in game = guild activity
};

export const weekDayNames = {
  th: ["วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์", "วันอาทิตย์"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};
export const weekDayShort = {
  th: ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

/** Days (0 = Monday) whose activities are highlighted as guild days. */
export const guildDays = [1, 3, 6];

export type QueueCategory = "gear" | "card" | "relic";
export const queueCategories: { id: QueueCategory; label: string; labelTh: string }[] = [
  { id: "gear", label: "Gear", labelTh: "Gear (อุปกรณ์)" },
  { id: "card", label: "Card", labelTh: "Card (การ์ด)" },
  { id: "relic", label: "Relic", labelTh: "Relic (เรลิก)" },
];
export type QueueEntry = { member: string; joinedAt: number };
export type Queues = Record<QueueCategory, QueueEntry[]>;
export type AuctionOffer = { id: number; category: QueueCategory; itemName: string; job: number | null; openedAt: number };
export type QueueLogEntry = { id: number; time: number; category: QueueCategory; itemName: string; job: number | null; member: string | null; result: "taken" | "declined" | "no-taker" };
export const emptyQueues = (): Queues => ({ gear: [], card: [], relic: [] });

export const timeSlots = ["08:00", "12:00", "13:00", "18:00", "19:00", "20:00", "21:00", "21:30", "22:00"];

export const scheduleEvents: ScheduleEvent[] = [
  { id: "luminous-vale", name: "Luminous Vale", day: 5, slot: "08:00", start: "08:00", end: "23:59" },
  { id: "graduate-exam", name: "การประเมินบัณฑิต", day: 4, slot: "12:00", start: "12:00", end: "18:00" },
  { id: "polarity-zone", name: "Polarity Zone", day: 6, slot: "12:00", start: "12:00", end: "21:00", guild: true },
  { id: "king-battle", name: "ศึกราชันย์", day: 5, slot: "13:00", start: "13:00", end: "23:59" },
  { id: "king-battle-cross", name: "ศึกราชันย์ข้ามเซิร์ฟ", day: 5, slot: "18:00", start: "18:00", end: "19:59" },
  { id: "sage-selection", name: "การคัดเลือก Sage", day: 4, slot: "19:00", start: "19:00", end: "19:30" },
  { id: "clash-of-the-chosen", name: "Clash of the Chosen", day: 5, slot: "20:00", start: "20:00", end: "20:50" },
  { id: "family-party", name: "งานเลี้ยงครอบครัว", day: 1, slot: "21:00", start: "21:00", end: "21:25" },
  { id: "mirror-world", name: "Mirror World", day: 3, slot: "21:00", start: "21:00", end: "21:15", guild: true },
  { id: "hoppy-quiz", name: "Hoppy Quiz", day: 4, slot: "21:00", start: "21:00", end: "21:30" },
  { id: "castle-siege", name: "ศึกชิงปราสาท", day: 6, slot: "21:00", start: "21:00", end: "22:00" },
  { id: "guild-league-tue-1", name: "Guild League", day: 1, slot: "21:30", start: "21:30", end: "21:55", guild: true },
  { id: "ancient-ruins", name: "Ancient Ruins", day: 2, slot: "21:30", start: "21:30", end: "22:15" },
  { id: "hazy-forest", name: "Hazy Forest", day: 3, slot: "21:30", start: "21:30", end: "21:45", guild: true },
  { id: "guild-league-tue-2", name: "Guild League", day: 1, slot: "22:00", start: "22:00", end: "22:25", guild: true },
  { id: "guild-league-thu", name: "Guild League", day: 3, slot: "22:00", start: "22:00", end: "22:25", guild: true },
];

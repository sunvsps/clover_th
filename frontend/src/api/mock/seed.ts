// Seed data for the in-browser mock backend. Mirrors backend/prisma/seed.ts plus the guild roster.
// Class names and colours follow the in-game class list (IMG_2028-2030) so a guild CSV export matches every row.
export const seedJobs = [
  { id: 1, label: "High Priest", color: "#5cb454" },
  { id: 2, label: "Lord Knight", color: "#e04e4b" },
  { id: 3, label: "High Wizard", color: "#3a95e8" },
  { id: 4, label: "Sniper", color: "#e3b53c" },
  { id: 5, label: "Night Walker", color: "#b8682c" },
  { id: 6, label: "อาลิเทีย", color: "#3fb3a1" },
  { id: 7, label: "Assassin Cross", color: "#9a6fdc" },
  { id: 8, label: "Paladin", color: "#bf3f35" },
  { id: 9, label: "Whitesmith", color: "#ea6f22" },
  { id: 10, label: "Champion", color: "#9ccc3c" },
  { id: 11, label: "Rebel", color: "#7a8fb5" },
];

export const seedRoster: Record<number, string[]> = {
  1: ["zearthz", "ลูกแกะผู้หลงทาง", "Czz", "Free_Kill", "DusChMill", "แมวกระเป๋า", "หมัดมังคุด", "Mirabi", "เสีEวค่ะXลวงMา", "GuGa", "ตาแกะ", "Booooo", "TaDa", "l333l", "JeeNz", "Eii3", "TAY", "วู้ววหูววว", "lnwสงคราม", "ChonYa", "คณะสงฆ์ไทย", "ขนมปังปิ้งง", "ตัวไก่กุ๊กๆ", "Lerp", "Tofus"],
  2: ["Mimayuu", "lwชsssss", "Claude", "Chell", "MufasA", "มาให้แทงสะดีๆ", "ทะลวงรูโบ๋เบ๋", "แล้วแต่อะ", "LittelME"],
  3: ["Gantzping", "ขออนุญาตมาดดด", "v16", "Yumeiiko", "เสือจ้า", "BXNGBXNG", "พยูนไม่ได้ฆ่า", "55XxX55"],
  4: ["มันกะเย", "oOSudtingOo", "BeN888", "Chaplin", "Kanade", "Bosu"],
  5: ["Nuririn", "TYESO", "Apori", "ปุ๋ง-ปุ๋งงง", "Yiren", "-จoมมๅรบุญ-", "Psychology", "วานิลาครีมชมพู", "เสือดํา", "Nim", "Dopeboyz", "จิวยี่", "PENNYWISEz", "SerizawaZ", "-nara-", "Gugora", "MERRIN", "มะงึก", "Piraru", "BTราชามาร", "HANIRUKA"],
  6: ["COSMOx", "SunnyInwZa", "ฮๅโย่ววว", "อาเนียจัง", "Halseyz", "CoolTM", "Judazz", "lSephirothl"],
  7: ["HuM", "หอยขม", "STELLAomg!", "ooMrmrakoo", "HoMies58", "กะปุ๋ง", "SweetLove"],
  8: ["กขคง", "คนหลงทาง", "หมูอบเนย", "OriginI", "ThanaKetkaew", "เบลล์_อาร์", "oาsยา", "Desk"],
  9: ["น้องดอกบัวตอง", "IAMAHERO", "MaMaMeaw", "Muck", "ตีไปเถอะ"],
  10: ["Sad-Bang", "น้องแมวส้ม"],
  11: ["Thornveil"],
};
/** Demo admins (guild leadership). */
export const seedAdmins = ["zearthz", "COSMOx", "Mimayuu", "Gantzping"];

export const seedActivities = [
  { id: "luminous-vale", name: "Luminous Vale" },
  { id: "graduate-exam", name: "การประเมินบัณฑิต" },
  { id: "polarity-zone", name: "Polarity Zone", isGuild: true, hasPlanner: true, autoBackfill: true },
  { id: "king-battle", name: "ศึกราชันย์" },
  { id: "king-battle-cross", name: "ศึกราชันย์ข้ามเซิร์ฟ" },
  { id: "sage-selection", name: "การคัดเลือก Sage" },
  { id: "clash-of-the-chosen", name: "Clash of the Chosen" },
  { id: "family-party", name: "งานเลี้ยงครอบครัว" },
  { id: "mirror-world", name: "Mirror World", isGuild: true, hasPlanner: true },
  { id: "hoppy-quiz", name: "Hoppy Quiz" },
  { id: "castle-siege", name: "ศึกชิงปราสาท", hasPlanner: true },
  { id: "guild-league", name: "Guild League", isGuild: true, hasPlanner: true },
  { id: "ancient-ruins", name: "Ancient Ruins" },
  { id: "hazy-forest", name: "Hazy Forest", isGuild: true },
];

export const seedEvents = [
  { id: "luminous-vale", activityId: "luminous-vale", day: 5, start: "08:00", end: "23:59" },
  { id: "graduate-exam", activityId: "graduate-exam", day: 4, start: "12:00", end: "18:00" },
  { id: "polarity-zone", activityId: "polarity-zone", day: 6, start: "12:00", end: "21:00" },
  { id: "king-battle", activityId: "king-battle", day: 5, start: "13:00", end: "23:59" },
  { id: "king-battle-cross", activityId: "king-battle-cross", day: 5, start: "18:00", end: "19:59" },
  { id: "sage-selection", activityId: "sage-selection", day: 4, start: "19:00", end: "19:30" },
  { id: "clash-of-the-chosen", activityId: "clash-of-the-chosen", day: 5, start: "20:00", end: "20:50" },
  { id: "family-party", activityId: "family-party", day: 1, start: "21:00", end: "21:25" },
  { id: "mirror-world", activityId: "mirror-world", day: 3, start: "21:00", end: "21:15" },
  { id: "hoppy-quiz", activityId: "hoppy-quiz", day: 4, start: "21:00", end: "21:30" },
  { id: "castle-siege", activityId: "castle-siege", day: 6, start: "21:00", end: "22:00" },
  { id: "guild-league-tue-1", activityId: "guild-league", day: 1, start: "21:30", end: "21:55" },
  { id: "ancient-ruins", activityId: "ancient-ruins", day: 2, start: "21:30", end: "22:15" },
  { id: "hazy-forest", activityId: "hazy-forest", day: 3, start: "21:30", end: "21:45" },
  { id: "guild-league-tue-2", activityId: "guild-league", day: 1, start: "22:00", end: "22:25" },
  { id: "guild-league-thu", activityId: "guild-league", day: 3, start: "22:00", end: "22:25" },
];

/** Main is split into groups (A, B, ...) of 5-member subteams; Sub stays a flat list of subteams. */
export const seedLayouts: Record<string, { key: string; name: string; teams?: number; groups?: { label: string; teams: number }[] }[]> = {
  "guild-league": [
    { key: "main", name: "Main", groups: [{ label: "A", teams: 4 }, { label: "B", teams: 4 }, { label: "C", teams: 4 }] },
    { key: "sub", name: "Sub", teams: 18 },
  ],
  "polarity-zone": [
    { key: "main", name: "Main", groups: [{ label: "A", teams: 8 }, { label: "B", teams: 8 }] },
    { key: "sub", name: "Sub", teams: 8 },
  ],
  "mirror-world": [
    { key: "main", name: "Main", groups: [{ label: "A", teams: 4 }, { label: "B", teams: 4 }] },
    { key: "sub", name: "Sub", teams: 4 },
  ],
  "castle-siege": [
    { key: "main", name: "Main", groups: [{ label: "A", teams: 4 }, { label: "B", teams: 4 }] },
    { key: "sub", name: "Sub", teams: 4 },
  ],
};

// Seed data for the in-browser mock backend. Mirrors backend/prisma/seed.ts plus the guild roster.
export const seedJobs = [
  { id: 1, label: "High Priest", color: "#5cb454" },
  { id: 2, label: "Knight", color: "#e04e4b" },
  { id: 3, label: "Wizard", color: "#3a95e8" },
  { id: 4, label: "Sniper", color: "#e3b53c" },
  { id: 5, label: "Gunslinger", color: "#b8682c" },
  { id: 6, label: "ดรูอิด", color: "#3fb3a1" },
  { id: 7, label: "Assassin", color: "#9a6fdc" },
  { id: 8, label: "Paladin", color: "#bf3f35" },
];

export const seedRoster: Record<number, string[]> = {
  1: ["zearthz", "หมัดมังคุด", "ลูกแกะผู้หลงทาง", "ChonYa", "Czz", "Free_Kill", "DuschMill", "Lerp", "JeeNz", "l333l", "ตัวไก่กุ๊กๆ", "Eii3", "Tofus", "แมวกระเป๋า", "lnwสงคราม", "Booooo", "เสีEวค่ะXลวงMา", "Mirabi", "ขนมปังปิ้ง", "น้องแมวส้ม/หมัด", "T A Y"],
  2: ["Mimayu", "Claude", "เฟซssssss", "หมูอบเนย", "ทะลวงรูโบ๋เบ๋", "เบลล์_อาร์", "อารยา", "Desk", "คนหลงทาง", "ThanaKetkaew", "กขคง", "LittelME"],
  3: ["Gantzping", "พยูนไม่ได้ฆ่า", "CoolTM", "V16", "BXNGBXNG", "เสือจ้า", "55XxX55"],
  4: ["มันกะเย", "o0Sudting0o", "น้องดอกบัวตอง", "Kanade", "BeN888", "จิวยี่"],
  5: ["Yiren", "Nuririn", "วานิลาครีมชมพู", "Apori", "Nim", "BTราชามาร", "Thornveil", "Gugora", "HANIRUKA", "-nara-", "Piraru", "มะงึก", "เสือดำ", "-จอมมารบุญ-", "TYESO"],
  6: ["COSMOx", "อาเนียจัง", "Halseyz", "lSephirothl", "Judazz", "SunnylnwZa"],
  7: ["HuM", "HoMies58", "ooMrmrakoo", "หอยขม", "SweetLove"],
  8: ["MaMaMeaw", "Muck", "ตีไปเถอะ", "IAMAHERO"],
};
/** Demo admins (guild leadership). */
export const seedAdmins = ["zearthz", "COSMOx", "Mimayu", "Gantzping"];

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

export const seedLayouts: Record<string, { key: string; name: string; teams: number }[]> = {
  "guild-league": [
    { key: "main", name: "Main", teams: 12 },
    { key: "sub", name: "Sub", teams: 18 },
  ],
  "polarity-zone": [{ key: "default", name: "Main", teams: 10 }],
  "mirror-world": [{ key: "default", name: "Main", teams: 8 }],
  "castle-siege": [{ key: "default", name: "Main", teams: 8 }],
};

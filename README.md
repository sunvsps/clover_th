# Clover_TH Guild Manager

ระบบจัดการกิจกรรมของกิลด์ Clover_TH (Ragnarok: The New World) ประกอบด้วย

1. **ประมูลกิลด์** มี 2 แบบ
   - แบบกดแข่ง (Pet, วัสดุ, กล่องอัญมณี): เปิด 5 นาที ใครกดเร็วสุดได้ชิ้นนั้น จำกัดคนละ 5 ชิ้นต่อรอบ
   - แบบคิว (Gear, การ์ด, Relic): เข้าคิวแยกตามหมวด กดสนใจและจัดอันดับของที่ต้องการ แล้วระบบจัดสรรตามลำดับคิว ของที่เหลือไปเป็นรอบแบบกดแข่ง
2. **ลงชื่อร่วมกิจกรรมรายสัปดาห์** ลงชื่อ ยกเลิก ตั้งสถานะลา และมีตัวสำรองเลื่อนขึ้นอัตโนมัติเมื่อกิจกรรมตั้งเพดานไว้
3. **จัดทีม (Team planner)** ต่อกิจกรรม (Mirror World, Guild League, Castle Siege, Polarity Zone) เฉพาะแอดมินจัดได้ คนอื่นดูอย่างเดียว Polarity Zone ตัวสำรองเข้าแทนที่นั่งที่ว่างอัตโนมัติและแจ้งเตือนผ่าน Discord

ล็อกอินด้วย Discord ได้เฉพาะสมาชิกที่บอทลงทะเบียนไว้แล้ว

## โครงสร้างโปรเจกต์

| โฟลเดอร์ | คืออะไร |
|---|---|
| `backend/` | Node.js + Fastify + Prisma + PostgreSQL (API ที่ `/api/v1`) |
| `frontend/` | React 19 + TypeScript + Vite |
| `docs/` | requirements, ดีไซน์, รายงาน QA/ความปลอดภัย, คู่มือติดตั้งและ Postman |

## ที่ต้องมี

- Node.js 22 ขึ้นไป (`node -v`)
- Docker Desktop (สำหรับ PostgreSQL ในเครื่อง)

## รันครั้งแรก (แบบง่าย: รันตัวเดียว)

backend ส่งไฟล์หน้าเว็บที่ build แล้วให้เอง จึงเปิดได้ทั้งเว็บและ API ที่ `http://localhost:3000`

**1. เปิดฐานข้อมูล**

```bash
cd backend
docker compose up -d db
```

**2. ตั้งค่า `backend/.env`**

```bash
cp .env.example .env
```

แก้ค่าเหล่านี้ใน `.env`

```
NODE_ENV=development
DATABASE_URL=postgresql://clover:clover@localhost:55432/clover?connection_limit=25&pool_timeout=10
SESSION_SECRET=<ค่าสุ่มอย่างน้อย 32 ตัวอักษร เช่นจาก: openssl rand -base64 48>
FRONTEND_URL=http://localhost:3000
DISCORD_CLIENT_ID=dummy
DISCORD_CLIENT_SECRET=dummy
DISCORD_REDIRECT_URI=http://localhost:3000/api/v1/auth/discord/callback
```

`FRONTEND_URL` ต้องตรงกับที่เปิดในเบราว์เซอร์เป๊ะ (พอร์ต 3000) เพราะ backend ตรวจ `Origin` กับค่านี้ ส่วนค่า Discord ใส่หลอกไว้ได้ถ้ายังไม่ล็อกอินด้วย Discord จริง

**3. build หน้าเว็บ**

```bash
cd frontend
npm ci
npm run build
```

**4. เตรียมฐานข้อมูล** (ทำใน `backend/`)

```bash
cd backend
set -a; source .env; set +a
npm ci
npm run db:migrate
npm run db:seed -- --dev
```

seed แบบ `--dev` สร้างอาชีพ กิจกรรม 16 รายการ ผังทีม และสมาชิกตัวอย่าง 5 คน (Discord id `900000000000000000` เป็นแอดมิน, `...001` ถึง `...004` เป็นสมาชิกทั่วไป)

**5. เปิดเซิร์ฟเวอร์**

```bash
npm run dev
```

เปิด http://localhost:3000 ถ้าขึ้นหน้าล็อกอินแสดงว่าสำเร็จ (เช็กสถานะได้ที่ `/healthz`) ถ้า build หน้าเว็บใหม่ ต้องรีสตาร์ทเซิร์ฟเวอร์ เพราะรายการไฟล์ถูกอ่านตอนเริ่ม

> ทุกครั้งที่เปิด terminal ใหม่เพื่อรันคำสั่งใน `backend/` ต้องโหลดค่า env ก่อนด้วย `set -a; source .env; set +a`

## ล็อกอินตอนพัฒนา

**วิธี A: cookie ทดสอบ (ไม่ต้องใช้ Discord)** ใน `backend/` (โหลด env แล้ว)

```bash
npm run dev-login -- 900000000000000000
```

คัดลอกค่า `session=...` ที่พิมพ์ออกมา เปิดหน้าเว็บ กด F12 ไปที่ Console แล้วรัน

```js
document.cookie = "session=<ค่าที่ได้>; path=/"
```

รีเฟรชหน้า ก็จะล็อกอินเป็นสมาชิกคนนั้น สคริปต์นี้ทำงานเฉพาะนอก production และไม่มี HTTP route ให้ใช้ cookie นี้ล็อกอินได้จริง อย่าส่งต่อหรือเก็บลงไฟล์

**วิธี B: Discord จริง** สร้าง application ใน Discord Developer Portal เพิ่ม redirect URI ให้ตรงกับ `DISCORD_REDIRECT_URI` แล้วใส่ `DISCORD_CLIENT_ID` กับ `DISCORD_CLIENT_SECRET` ใน `.env` เฉพาะสมาชิกที่บอทลงทะเบียนและยังใช้งานอยู่เท่านั้นที่ล็อกอินได้

## โหมดพัฒนา frontend (hot reload)

ถ้ากำลังแก้หน้าเว็บ ให้รัน backend กับ Vite แยกกัน

- backend: `npm run dev` ใน `backend/` (พอร์ต 3000)
- frontend: `npm run dev` ใน `frontend/` (พอร์ต 5173) Vite proxy `/api` ไปหา backend ให้เอง
- ตั้ง `FRONTEND_URL=http://localhost:5173` ใน `backend/.env` และ redirect URI เป็นพอร์ต 5173 ให้ตรงกัน

## ตั้งแอดมินและบอท

- ตั้งแอดมิน: ต้องมีสมาชิกนั้นอยู่ในระบบก่อน แล้วรัน `npm run grant-admin -- <discordId>` ใน `backend/` (ไม่มี API หรือหน้าเว็บให้สิทธิ์แอดมิน)
- key ของบอท: `npm run hash-bot-key -- --generate` ได้ key ให้บอทใช้ใน header `X-Bot-Key` และค่า digest ให้ใส่ใน `BOT_API_KEYS` ของ `.env`
- บอทลงทะเบียนสมาชิกด้วย `PUT /api/v1/bot/members/<discordId>` (ชื่อในเกม อาชีพ และชื่อเล่น) และ deactivate ด้วย `POST /api/v1/bot/members/<discordId>/deactivate`

ลองยิง API ด้วย Postman ตามคู่มือ [docs/postman.md](docs/postman.md)

## เทสต์

Backend (ต้องเปิด Docker Desktop สคริปต์สร้าง Postgres ชั่วคราวเอง)

```bash
cd backend
bash scripts/ci.sh
```

Frontend

```bash
cd frontend
npm run lint
npm test
npm run build
```

## เอกสาร

| ไฟล์ | เนื้อหา |
|---|---|
| [docs/requirements.th.md](docs/requirements.th.md) / [docs/requirements.md](docs/requirements.md) | requirements ฉบับสุดท้าย (ไทย / อังกฤษ) |
| [docs/backend-design.md](docs/backend-design.md) | ดีไซน์ backend, ER schema, API และแผนงาน (WP1 ถึง WP15) |
| [docs/design-review.md](docs/design-review.md) | ผลรีวิวดีไซน์ |
| [docs/qa-report-wp1-wp6.md](docs/qa-report-wp1-wp6.md) | รายงาน QA ของ WP1 ถึง WP6 |
| [docs/security-review.md](docs/security-review.md) | รายงานตรวจความปลอดภัยของ backend |
| [docs/deploy.md](docs/deploy.md) | ติดตั้งจริง (env, migrate, proxy, backup) |
| [docs/postman.md](docs/postman.md) | ทดสอบ API ด้วย Postman |

## ถ้าติดปัญหา

- **เซิร์ฟเวอร์ไม่ขึ้น (`npm run dev` ค้างเงียบๆ):** ดู error ใน terminal ส่วนมากเพราะไม่ได้โหลด env (`set -a; source .env; set +a`), `SESSION_SECRET` สั้นเกินไป หรือยังไม่ได้ `db:migrate`
- **ขึ้น `CSRF_REJECTED` ตอนบันทึกข้อมูล:** `FRONTEND_URL` ไม่ตรงกับ URL ที่เปิดในเบราว์เซอร์ แก้แล้วรีสตาร์ทเซิร์ฟเวอร์
- **เห็นแต่ JSON ไม่เห็นหน้าเว็บ:** ยังไม่ได้ build frontend (`npm run build` ใน `frontend/`) แล้วรีสตาร์ท backend
- **พอร์ต 55432 ชน:** ตั้ง `DB_PORT` เป็นพอร์ตอื่นสำหรับ docker compose และแก้ `DATABASE_URL` ให้ตรงกัน

## ปิดทุกอย่าง

กด Ctrl+C ที่เซิร์ฟเวอร์ แล้วรัน `docker compose down` ใน `backend/` ข้อมูลในฐานข้อมูลทดสอบจะหายไป เพราะเก็บในหน่วยความจำ

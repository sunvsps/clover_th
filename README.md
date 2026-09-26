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
BOT_API_KEYS=0000000000000000000000000000000000000000000000000000000000000000
LOCAL_DEMO_ENABLED=true
```

`FRONTEND_URL` ต้องตรงกับที่เปิดในเบราว์เซอร์เป๊ะ (พอร์ต 3000) เพราะ backend ตรวจ `Origin` กับค่านี้ ส่วนค่า Discord ใส่หลอกไว้ได้ถ้ายังไม่ล็อกอินด้วย Discord จริง

`LOCAL_DEMO_ENABLED=true` เปิดปุ่มล็อกอินสาธิตในหน้าเว็บ (ดูหัวข้อถัดไป) ใช้เฉพาะในเครื่องตัวเอง **ห้ามตั้งบนเซิร์ฟเวอร์จริง** ถ้าตั้งคู่กับ `NODE_ENV=production` เซิร์ฟเวอร์จะไม่ยอมสตาร์ท และค่าต้องเป็น `true` หรือ `false` เท่านั้น

`BOT_API_KEYS` **ห้ามเว้นว่าง** ต้องเป็นค่า sha256 (ตัวอักษร hex 64 ตัว) 1 หรือ 2 ค่าคั่นด้วยจุลภาค ไม่งั้นเซิร์ฟเวอร์จะไม่ยอมสตาร์ท ถ้ายังไม่ต่อบอท ใช้ค่าศูนย์ 64 ตัวตามตัวอย่างข้างบนได้ (ไม่มี key ใดที่แปลงเป็นค่านี้ได้ จึงเท่ากับปิด endpoint ของบอท) เมื่อจะต่อบอทจริงให้สร้างค่าด้วย `npm run hash-bot-key -- --generate`

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

**ตอนนี้ยังไม่ได้ต่อ Discord จริง** (ยังไม่มี Discord application) ปุ่ม "Sign in with Discord" จึงยังใช้ไม่ได้ ให้ใช้ล็อกอินสาธิตแทน

**วิธีที่ง่ายที่สุด: ล็อกอินสาธิต** ตั้ง `LOCAL_DEMO_ENABLED=true` ใน `backend/.env` แล้วรีสตาร์ทเซิร์ฟเวอร์ เปิด http://localhost:3000 จะเห็นกล่อง "Demo login (local only)" รายชื่อสมาชิกตัวอย่าง (แอดมินมีป้าย Admin) กดปุ่ม "Sign in" ข้างชื่อที่ต้องการ ก็เข้าระบบเป็นคนนั้น ปุ่มนี้ทำงานเฉพาะกับเครื่องที่รันเซิร์ฟเวอร์ (loopback) และเมื่อปิด flag เส้นทาง `/api/v1/demo/*` จะไม่มีอยู่เลย (404)

**วิธีทางเลือก: cookie ทดสอบ (ไม่ต้องใช้ Discord และไม่ต้องตั้ง flag)** ใน `backend/` (โหลด env แล้ว)

```bash
npm run dev-login -- 900000000000000000
```

คัดลอกค่า `session=...` ที่พิมพ์ออกมา เปิดหน้าเว็บ กด F12 ไปที่ Console แล้วรัน

```js
document.cookie = "session=<ค่าที่ได้>; path=/"
```

รีเฟรชหน้า ก็จะล็อกอินเป็นสมาชิกคนนั้น สคริปต์นี้ทำงานเฉพาะนอก production อย่าส่งต่อหรือเก็บลงไฟล์

**Discord จริง (ยังไม่ได้ต่อ)** สร้าง application ใน Discord Developer Portal เพิ่ม redirect URI ให้ตรงกับ `DISCORD_REDIRECT_URI` แล้วใส่ `DISCORD_CLIENT_ID` กับ `DISCORD_CLIENT_SECRET` ใน `.env` เฉพาะสมาชิกที่บอทลงทะเบียนและยังใช้งานอยู่เท่านั้นที่ล็อกอินได้

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

## Deploy เวอร์ชันทดลอง (staging) บน Railway

> **สถานะ:** repo มี `Dockerfile` ที่ build ทั้ง frontend และ backend เป็น container เดียวแล้ว (ทดสอบจริงแล้วในเครื่อง: `docker build` สำเร็จ, `prisma migrate deploy` และ seed รันผ่าน, container ตอบ `/healthz` และหน้าเว็บได้ปกติ, `/docs/json` เป็น 404 ตาม production) ส่วนขั้นตอนกดในหน้าเว็บ Railway เองยังไม่เคยลองจริง ชื่อเมนูอาจต่างเล็กน้อย รายละเอียดตัวแปรและ backup ดู [docs/deploy.md](docs/deploy.md)

ข้อควรรู้ก่อนเริ่ม

- **ล็อกอินสาธิต (`LOCAL_DEMO_ENABLED`) ใช้บน Railway ไม่ได้** เซิร์ฟเวอร์ปฏิเสธการสตาร์ทเมื่อตั้งคู่กับ `NODE_ENV=production` ผู้ทดลองจึงต้องล็อกอินด้วย Discord จริง และต้องถูกลงทะเบียนไว้ก่อน
- ให้ตั้ง `NODE_ENV=production` แม้เป็นเว็บทดลอง เพราะเว็บอยู่บนอินเทอร์เน็ตจริง (cookie ปลอดภัย เอกสาร API ถูกปิด)
- `db:seed -- --dev` (สมาชิกปลอม) รันไม่ได้ตอน production สมาชิกต้องมาจากบอทหรือคุณลงทะเบียนเอง
- ใช้โปรเจกต์ Railway และ Postgres แยกจากของจริง และรันได้เพียง **1 replica** เท่านั้น

**1. ตั้ง Discord application** (Developer Portal: https://discord.com/developers/applications)
สร้าง New Application แล้วคัดลอก Client ID กับ Client Secret เพิ่ม Redirect `https://<โดเมน>/api/v1/auth/discord/callback` (ทำหลังได้โดเมนในขั้น 4) และเปิด Developer Mode ใน Discord เพื่อ Copy User ID ของผู้ทดลองแต่ละคน

**2. สร้างโปรเจกต์บน Railway**
New Project แล้ว Deploy from GitHub repo เลือก `sunvsps/cover_th` ตั้ง Branch เป็น `feature/frontend-api-integration` แล้วเพิ่มฐานข้อมูลด้วย + New แล้ว Database แล้ว PostgreSQL

**3. ตั้ง build และ start** (Settings ของเซอร์วิส)

Railway จะเจอ `Dockerfile` ที่ root ของ repo เองอัตโนมัติ (มีไฟล์ `railway.toml` กำกับไว้แล้วว่าให้ build ด้วย Dockerfile และเช็ก `/healthz`) ไม่ต้องตั้ง Build/Start Command เอง เหลือแค่ตั้ง **Pre-Deploy Command** ที่ Settings → Deploy ของเซอร์วิส:

```
npx prisma migrate deploy && node dist/prisma/seed.js
```

(สคริปต์ seed ถูก build เป็น JS แล้วในอิมเมจ ไม่ต้องใช้ `tsx`) `node dist/prisma/seed.js` แบบไม่มี `--dev` สร้างอาชีพ กิจกรรม และผังทีมเริ่มต้น รันซ้ำได้ไม่เกิดข้อมูลซ้ำ Healthcheck Path ถูกตั้งไว้ใน `railway.toml` แล้วเป็น `/healthz`

**4. สร้างโดเมน**
Settings แล้ว Networking แล้ว Generate Domain (ได้ HTTPS อัตโนมัติ) แล้วนำโดเมนไปใส่ Redirect ของ Discord ในขั้น 1

**5. ตั้งตัวแปร** (Variables ของเซอร์วิส)

| ตัวแปร | ค่า |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | อ้างอิงจากเซอร์วิส Postgres แล้วต่อท้าย `?connection_limit=25&pool_timeout=10` |
| `SESSION_SECRET` | ค่าสุ่มจาก `openssl rand -base64 48` |
| `FRONTEND_URL` | `https://<โดเมน>` ต้องตรงกับที่ผู้ใช้เปิดเป๊ะ |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | จากขั้น 1 |
| `DISCORD_REDIRECT_URI` | `https://<โดเมน>/api/v1/auth/discord/callback` |
| `BOT_API_KEYS` | ค่า digest จริงจาก `npm run hash-bot-key -- --generate` (ค่า `bot key` ที่ได้ไว้ใช้ยิงเอง ห้ามใส่ใน Railway) |
| `TRUST_PROXY_HOPS` | `1` (ควรตรวจว่า IP ผู้ใช้ที่ระบบเห็นไม่ใช่ IP ของ proxy) |
| `NOTIFICATIONS_PROVIDER` | `off` (จนกว่าจะรู้ว่าบอทรับ HTTP ได้) |

**ห้ามตั้ง `LOCAL_DEMO_ENABLED`** พอตั้งเสร็จ Railway จะ deploy ใหม่เอง รอสถานะ Active

**6. ลงทะเบียนผู้ทดลองและตั้งแอดมิน**
ลงทะเบียนทีละคนจากเครื่องคุณ (ชื่ออาชีพต้องตรงกับที่มีในระบบ ไม่งั้นได้ `INVALID_JOB`)

```bash
curl -X PUT "https://<โดเมน>/api/v1/bot/members/<Discord User ID>" -H "X-Bot-Key: <bot key>" -H "Content-Type: application/json" -d '{"ign":"<ชื่อในเกม>","job":"<อาชีพ>","nickname":"<ชื่อเล่น>"}'
```

ตั้งตัวเองเป็นแอดมินด้วยสคริปต์ที่ต่อฐานข้อมูลผ่าน connection URL สาธารณะของ Postgres (ตัวแปร `DATABASE_PUBLIC_URL` ของเซอร์วิส Postgres URL นี้คือรหัสผ่าน ห้ามส่งหรือเก็บลงไฟล์)

```bash
DATABASE_URL="<DATABASE_PUBLIC_URL>" npm run grant-admin -- <Discord User ID>
```

**7. ตรวจ**
เปิด `https://<โดเมน>/healthz` (ต้องปกติ), เปิดหน้าเว็บแล้วกด Sign in with Discord (ต้องกลับมาเป็นแอดมินพร้อมแท็บ Admin) และ `https://<โดเมน>/docs/json` ต้องได้ 404

หลังมีสมาชิกครบ ให้แอดมินสร้างรอบประมูลตัวอย่างและตั้งค่ากิจกรรมในหน้า Admin เพื่อให้ผู้ทดลองมีของให้ลอง

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
| [docs/local-setup.md](docs/local-setup.md) | ตั้งค่าเครื่องใหม่หลัง Docker เปิดขึ้นมา (migrate, seed, login) step by step |
| [docs/postman.md](docs/postman.md) | ทดสอบ API ด้วย Postman |

## ถ้าติดปัญหา

- **เซิร์ฟเวอร์ไม่ขึ้น (`npm run dev` ค้างเงียบๆ):** ดู error ใน terminal ส่วนมากเพราะไม่ได้โหลด env (`set -a; source .env; set +a`), `SESSION_SECRET` สั้นเกินไป, `BOT_API_KEYS` ว่างหรือไม่ใช่ค่า sha256 64 ตัวอักษร หรือยังไม่ได้ `db:migrate`
- **ขึ้น `CSRF_REJECTED` ตอนบันทึกข้อมูล:** `FRONTEND_URL` ไม่ตรงกับ URL ที่เปิดในเบราว์เซอร์ แก้แล้วรีสตาร์ทเซิร์ฟเวอร์
- **เห็นแต่ JSON ไม่เห็นหน้าเว็บ:** ยังไม่ได้ build frontend (`npm run build` ใน `frontend/`) แล้วรีสตาร์ท backend
- **พอร์ต 55432 ชน:** ตั้ง `DB_PORT` เป็นพอร์ตอื่นสำหรับ docker compose และแก้ `DATABASE_URL` ให้ตรงกัน

## ปิดทุกอย่าง

กด Ctrl+C ที่เซิร์ฟเวอร์ แล้วรัน `docker compose down` ใน `backend/` ข้อมูลในฐานข้อมูลทดสอบจะหายไป เพราะเก็บในหน่วยความจำ

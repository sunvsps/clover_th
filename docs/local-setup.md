# ตั้งค่าเครื่องใหม่หลัง Docker เปิดขึ้นมา (dev ในเครื่อง)

คู่มือนี้สำหรับตอน **Docker Desktop เพิ่งเปิด / restart / container DB ถูกสร้างใหม่** แล้วต้องการกลับมารันเว็บในเครื่องได้เหมือนเดิม

> **ทำไมต้องทำซ้ำทุกครั้ง:** container `cloverth-postgres` เก็บข้อมูลแบบ `tmpfs` (อยู่ใน RAM) ตามที่ตั้งไว้ใน [`backend/docker-compose.yml`](../backend/docker-compose.yml) ดังนั้นเมื่อ Docker restart หรือ container ถูกสร้างใหม่ **ตาราง สมาชิก และรอบประมูลทั้งหมดจะหายไป** ต้อง migrate และ seed ใหม่

ทุกคำสั่งรันจาก root ของ repo (`cover_th/`)

---

## 1. เปิด Docker Desktop

เปิดแอป Docker Desktop รอจนสถานะเป็น running แล้วเช็คว่าใช้ได้:

```bash
docker ps
```

ถ้าขึ้น `Cannot connect to the Docker daemon` แปลว่ายังไม่พร้อม รอสักครู่แล้วลองใหม่

## 2. เปิด DB

```bash
cd backend && docker compose up -d db
```

ได้ Postgres 16 ที่ `127.0.0.1:55432` (user / password / db เป็น `clover` ทั้งหมด ตรงกับ `DATABASE_URL` ใน `backend/.env`)

## 3. สร้างตารางและใส่ข้อมูลตัวอย่าง

```bash
cd backend && set -a && source .env && set +a && yarn db:migrate && yarn db:seed --dev
```

- `db:migrate` สร้างตารางทั้งหมดจาก `backend/prisma/migrations/`
- `db:seed --dev` สร้างอาชีพ กิจกรรม ผังทีม และสมาชิกตัวอย่าง 5 คน (Discord id `900000000000000000` เป็นแอดมิน, `...001` ถึง `...004` เป็นสมาชิกทั่วไป)

> ทุกครั้งที่เปิด terminal ใหม่เพื่อรันคำสั่งใน `backend/` ต้องโหลด env ก่อนด้วย `set -a && source .env && set +a`

## 4. รัน backend (terminal ที่ 1)

```bash
cd backend && set -a && source .env && set +a && yarn dev
```

เช็คที่ http://localhost:3000/healthz ต้องขึ้น `"db":"ok"`

## 5. รัน frontend (terminal ที่ 2)

```bash
cd frontend && yarn dev
```

เปิดเว็บที่ http://localhost:5173

## 6. Login

cookie session เดิมใช้ไม่ได้แล้ว เพราะสมาชิกใน DB ถูกสร้างใหม่ เลือกวิธีใดวิธีหนึ่ง

### แบบ A: Demo login (ไม่ต้องใช้ Discord)

1. ตั้งใน `backend/.env`:
   ```
   LOCAL_DEMO_ENABLED=true
   ```
2. restart backend (หยุด `yarn dev` ในขั้นที่ 4 แล้วรันใหม่)
3. เปิด http://localhost:5173 จะเห็นกล่อง "Demo login (local only)" กด "Sign in" ข้างชื่อที่ต้องการ (แอดมินมีป้าย Admin)

ใช้ได้เฉพาะในเครื่องตัวเอง **ห้ามตั้งบนเซิร์ฟเวอร์จริง** (ถ้าตั้งคู่กับ `NODE_ENV=production` เซิร์ฟเวอร์จะไม่ยอมสตาร์ท)

### แบบ B: Discord จริง

ต้องตั้ง `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` ใน `backend/.env` ไว้แล้ว และ DB ใหม่ยังไม่มีตัวคุณ ต้องลงทะเบียนก่อน (backend ต้องรันอยู่):

```bash
curl -X PUT "http://localhost:3000/api/v1/bot/members/<Discord User ID>" \
  -H "X-Bot-Key: 0000000000000000000000000000000000000000000000000000000000000000" \
  -H "Content-Type: application/json" \
  -d '{"ign":"<ชื่อในเกม>","job":"<ชื่ออาชีพที่มีในระบบ>","nickname":"<ชื่อเล่น>"}'
```

- `X-Bot-Key` ใช้ค่าศูนย์ 64 ตัวได้ถ้า `BOT_API_KEYS` ใน `.env` ยังเป็นค่า default
- `job` ต้องตรงกับชื่ออาชีพที่มีจาก seed เป๊ะๆ ไม่งั้นได้ `INVALID_JOB`
- หา Discord User ID: Discord → Settings → Advanced → เปิด Developer Mode → คลิกขวาที่ชื่อตัวเอง → Copy User ID

ให้สิทธิ์แอดมิน:

```bash
cd backend && set -a && source .env && set +a && yarn grant-admin -- <Discord User ID>
```

แล้วเปิดเว็บ กด "Sign in with Discord"

---

## ค่าใน `backend/.env` ที่ต้องตรงกับการรันแบบนี้

```
NODE_ENV=development
DATABASE_URL=postgresql://clover:clover@localhost:55432/clover?connection_limit=25&pool_timeout=10
FRONTEND_URL=http://localhost:5173
DISCORD_REDIRECT_URI=http://localhost:5173/api/v1/auth/discord/callback
```

`FRONTEND_URL` ต้องตรงกับที่เปิดในเบราว์เซอร์เป๊ะ (port 5173 เพราะเปิดผ่าน Vite) ไม่งั้น request ที่เขียนข้อมูลจะโดน CSRF ปฏิเสธ

## สรุปคำสั่ง (ลอก-วางต่อกัน)

```bash
docker ps
cd backend && docker compose up -d db
set -a && source .env && set +a
yarn db:migrate && yarn db:seed --dev
yarn dev
```

อีก terminal:

```bash
cd frontend && yarn dev
```

## ถ้าติดปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop ยังไม่เปิดหรือยังไม่พร้อม |
| `/healthz` ได้ `DB_UNAVAILABLE` | DB container ไม่ได้รัน → ทำขั้นที่ 2 |
| `relation "Member" does not exist` | DB ว่างเปล่า (container ถูกสร้างใหม่) → ทำขั้นที่ 3 |
| login แล้วเด้งกลับมาหน้า login / `AUTH_NOT_REGISTERED` | สมาชิกยังไม่อยู่ใน DB → ลงทะเบียนตามแบบ B หรือใช้ Demo login |
| ไม่เห็นกล่อง Demo login | `LOCAL_DEMO_ENABLED` ไม่ใช่ `true` หรือยังไม่ได้ restart backend หลังแก้ `.env` |
| `Port 3000 is already in use` | มี backend รันค้างอยู่แล้ว ใช้ตัวนั้นหรือหยุดก่อนรันใหม่ |

## ถ้าไม่อยากทำซ้ำทุกครั้ง

เปลี่ยน `tmpfs` ใน `backend/docker-compose.yml` เป็น named volume แล้วข้อมูลจะอยู่รอดหลัง Docker restart (ยังต้อง `yarn db:migrate` เมื่อมี migration ใหม่)

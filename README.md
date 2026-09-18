# Cover TH

Full-stack starter template:

- **Backend**: Node.js + Express + TypeScript + Prisma (PostgreSQL)
- **Frontend**: React + TypeScript + Vite

## Project structure

```
Cover_TH/
├── backend/     # Express API + Prisma
└── frontend/    # React app (Vite)
```

## Prerequisites

- Node.js 18+
- A PostgreSQL database (local or hosted)

## Backend setup

```bash
cd backend
npm install
cp .env.example .env   # edit DATABASE_URL to point at your Postgres instance
npx prisma migrate dev --name init
npm run dev
```

The API runs at `http://localhost:4000`.

Optional: seed sample data with `npm run prisma:seed`.

### Backend scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the API in watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:migrate` | Create/apply a migration |
| `npm run prisma:studio` | Open Prisma Studio (DB GUI) |
| `npm run prisma:seed` | Seed the database |

### API endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/api/todos` | List todos |
| POST | `/api/todos` | Create a todo (`{ title }`) |
| PATCH | `/api/todos/:id` | Update a todo (`{ title?, completed? }`) |
| DELETE | `/api/todos/:id` | Delete a todo |

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env   # edit VITE_API_URL if the backend runs elsewhere
npm run dev
```

The app runs at `http://localhost:5173` and talks to the backend via `VITE_API_URL`.

## Running both together

Open two terminals: one for `backend` (`npm run dev`) and one for `frontend` (`npm run dev`). Make sure `CORS_ORIGIN` in `backend/.env` matches the frontend's URL.

## Next steps

- Extend `backend/prisma/schema.prisma` with your own models, then run `npx prisma migrate dev`.
- Add authentication, validation, and additional routes under `backend/src/routes`.
- Replace the sample Todo UI in `frontend/src/App.tsx` with your own pages/components.

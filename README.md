# Andon

A small Next.js team dashboard for Andon-style status lights: 🟢 good, 🟡 waiting, 🔴 stopped.

Create a team, share an 8-character invite code, join with a name, and watch the board refresh every 1.5s.

## Setup

```bash
npm install
cp .env.example .env.local
```

Add a [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres) (now Neon) connection string to `.env.local`:

```
POSTGRES_URL=postgres://...
```

Tables are created automatically on the first API request. You can also run `scripts/schema.sql` yourself.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Flow

1. **Create** a team on `/` — get `team_id` and an invite code.
2. **Join** at `/join?code=ABC12345` — optional name, or we generate `Member-3847`.
3. **Dashboard** at `/dashboard?team_id=...` — members, current state, time in state, joined date.

Auth is a per-member `auth_token` stored in `localStorage`. State changes check that the token matches `member_id`.

## API

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| `POST` | `/api/team/create` | `{ name }` | `{ team_id, invite_code }` |
| `POST` | `/api/team/join` | `{ invite_code, name? }` | `{ team_id, member_id, auth_token, member_name }` |
| `POST` | `/api/state` | `{ team_id, member_id, state, auth_token }` | `{ ok }` |
| `GET` | `/api/team/status?team_id=` | | `{ team, members: [{ name, state, updated_at, ... }] }` |

`state` is `green` \| `yellow` \| `red`.

State transitions are written to `state_log` for a later leaderboard. The board already shows a light “wait champion” if someone is yellow.

## Deploy

Connect the repo to Vercel, add a Postgres store, and deploy. `POSTGRES_URL` is injected automatically.

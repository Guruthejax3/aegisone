# AegisOne application

AI agents can do useful work, but they can also send messages, change files, or access data. The risk is that an agent might take an action that wasn’t intended.
AegisOne is designed to check an agent’s proposed action before it happens. It can flag risky actions, require a separate person to approve them, and keep a record of what was reviewed. It's a responsive security operations dashboard inspired by the supplied Stitch screens, integrated with its local backend. The same Node server hosts the frontend and API, so browser requests use one origin.

## Start the app

Requires Node.js 26+ (the backend uses Node's built-in SQLite and TypeScript support). In a terminal:

```sh
npm start
```

Open `http://127.0.0.1:3001`. The backend creates a local SQLite sandbox with sample allowed, pending-approval, and blocked actions, plus a trace and audit history. When opened from `127.0.0.1` or `localhost`, the interface signs into the local sandbox automatically; no cloud account or credentials are needed. Demo role tokens are `aegis-sandbox-operator`, `aegis-sandbox-approver`, and `aegis-sandbox-admin`. Data is stored in `backend/aegisone.sqlite`.

The frontend is served by the backend at `/`; API calls use the same origin. No separate static server or CORS setup is needed.

## Frontend screens

- **Command center** — backend health and counts, audit activity, session preview risk distribution, and pending session approvals.
- **Consequence simulator / Policy & authorization** — validated action preview, policy and heuristic risk explanation, simulated outcomes, alternatives, separate-approver authorization, and mock-only commit.
- **Agent intelligence** — create provenance traces and inspect recorded events.
- **Evidence & audit** — view recent records and verify the hash chain.
- **Model intelligence / Red-team & evaluation** — model availability and synthetic test runs.

The approval panel includes role-visible pending actions from the local API, and audit changes stream over a persisted local SSE endpoint. Model comparison shows the heuristic, optional LLM adapter, and learned-model availability. Unsupported platform areas stay disabled. Connectors are mock-only, risk scores are heuristics rather than probabilities, and evaluation cases are synthetic rather than a security guarantee.

## Backend

See [backend/README.md](backend/README.md) for the API, security boundaries, configuration, and database notes. Admin and production setup details are in [backend/API.md](backend/API.md) and [backend/.env.example](backend/.env.example).

## Project files

- `index.html`, `styles.css`, `main.js` — dashboard and client API integration
- `assets/` and `fonts/` — visual assets
- `backend/` — Node.js backend, SQLite schema, Supabase migration, API docs, and backend tests




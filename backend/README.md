# AegisOne backend

The backend for the AegisOne application. It serves the dashboard from the project root and exposes the local API from the same origin.

## What works

- Authenticated versioned action gateway for mock email, file, API, and database action schemas; payload validation, per-actor idempotency, tracing headers, and process-local rate limiting.
- Deterministic risk assessment with the specified weights and factor explanations; strict policy decisions stored separately from risk; policy simulation endpoint.
- Deterministic consequence scenarios and risk-reducing alternative plan generation.
- Action preview, short expiry, canonical SHA-256 hash, HMAC-bound preview, separate approver role, separation of duties, rejection/cancellation, and exact-hash mock commit gate.
- Mock-only connectors. Commit writes a receipt/outbox record and performs no real external action.
- Trace/evidence events and causal graph nodes/edges. Evidence status distinguishes observation, inference, model explanation, and unknown; ordering is not treated as causation.
- Hash-chained audit records, verification, action history, pagination, and event filtering.
- A synthetic evaluation run that stores scenario version, model/policy versions, actual per-scenario results, confusion-matrix metrics, policy correctness, and timing measurements.
- Health and model registry endpoints that report unconfigured LLM and unavailable learned-model states honestly.
- Least-privilege agent registry, administrator-managed permission grants, immutable policy releases with configurable approval threshold, and stale-preview rejection after a policy release.
- Structured heuristic anomaly findings and a per-trace workflow risk aggregate, explicitly labeled as a heuristic rather than a probability.
- SQLite local persistence and a separate Supabase/PostgreSQL schema migration with RLS read policies.

## Run locally

Requires Node.js 26+ for built-in `node:sqlite` and TypeScript type stripping. No external npm packages or LLM key are needed.

```sh
npm test
npm start
```

The server binds only to `127.0.0.1`, serves the AegisOne frontend at `http://127.0.0.1:3001`, creates `aegisone.sqlite` in the backend folder, and prints random local demo bearer tokens for operator, approver, and administrator. A reviewer must use the approver token, different from the submitting actor. The administrator token manages agent permissions and policy releases. Set values from a secret manager in production; see `.env.example`. Production startup requires `AEGIS_HMAC_SECRET`, `AEGIS_OPERATOR_TOKEN`, `AEGIS_APPROVER_TOKEN`, and `AEGIS_ADMIN_TOKEN`, and refuses duplicate role tokens.

## API

Except `GET /api/health`, routes require `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/actions/preview` | Validate, assess, simulate, and preview `{agent_id, action, trace_id?}` |`n| GET | `/api/actions` | Role-visible action queue with optional status and limit filters |`n| GET | `/api/events` | Persisted audit SSE stream with reconnect cursor |
| GET | `/api/actions/:id` | Action state and history |
| GET | `/api/actions/:id/alternatives` | Goal-preserving counterfactual plans |
| GET | `/api/actions/:id/recovery` | Simulated recovery plan |
| POST | `/api/actions/:id/verify` | Verify mock commit receipt |
| GET | `/api/actions/:id/report` | Export evidence report |
| POST | `/api/actions/:id/approve` | Separate approver binds approval to exact hash |
| POST | `/api/actions/:id/reject` | Reject pending approval |
| POST | `/api/actions/:id/commit` | Mock commit using `{action_hash, preview_token}` |
| POST | `/api/actions/:id/cancel` | Cancel before commit |
| POST | `/api/policies/evaluate` | Simulate policy and heuristic assessment |
| GET | `/api/policies/current` | Read active policy version and fixed mandatory rules |
| POST | `/api/admin/policies` | Release a policy version with an approval threshold (admin only) |
| GET | `/api/agents` | List registered agents and effective permissions |
| POST | `/api/admin/agents` | Register an agent and its allowed permissions (admin only) |
| PUT | `/api/admin/agents/:id/permissions` | Replace an agent's permission grants (admin only) |
| POST | `/api/traces` | Create a trace (requires objective and original instruction) |
| GET | `/api/traces/:id` | Read trace, evidence events, causal nodes and edges |
| GET | `/api/traces/:id/risk` | Aggregate risk scores of actions linked to a trace |
| POST | `/api/traces/:id/events` | Record a redacted trace event |
| POST | `/api/traces/:id/edges` | Record a typed causal/dependency relationship |
| GET | `/api/audit`, `/api/audit/verify` | Paginate actor-visible audit events / verify the chain |
| POST | `/api/evaluations/run` | Run the synthetic suite (approver role) |
| GET | `/api/evaluations`, `/api/evaluations/:id` | Read evaluation runs and results |
| GET | `/api/governance/models` | Model availability and governance state |`n| POST | `/api/models/compare` | Persist heuristic, optional LLM, and learned-model comparison |
| GET | `/api/health`, `/api/system/health` | Basic and authenticated detailed health |

Example action:

```json
{
  "schema_version": "1.0",
  "kind": "email",
  "goal": "Notify the internal reviewer",
  "tool": "mock-email",
  "operation": "send",
  "resource": "mailbox/demo",
  "recipient": "reviewer@example.com",
  "data_classification": "internal",
  "content": "Please review the draft",
  "evidence_refs": [],
  "preconditions": ["recipient verified"],
  "permissions": ["email:send"],
  "correlation_id": "corr-123",
  "idempotency_key": "unique-request-123"
}
```

## Important limitations

This folder is a usable local backend, not the entire production platform described by the master specification. SQLite and demo bearer tokens are used at runtime; the Supabase migration is a schema starting point and has not been exercised against a Supabase project. Tenant isolation, Supabase Auth, deployed RLS, Supabase Realtime, transactional event publishing, and live frontend integration are not operational. Model 2 LLM reasoning is not implemented; Model 3 learned prediction is unavailable because no labelled dataset or trained model exists. Evaluation covers a small synthetic deterministic suite only; results are measurements of that run, not a security guarantee. Rate limiting is per process. A privileged administrator can rewrite a database and its hash chain. No regulatory compliance or production deployment readiness is claimed.

All action connectors remain mock-only. Never add real-effect connectors without an independently reviewed authorization flow and least-privilege credentials.






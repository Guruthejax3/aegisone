# AegisOne API overview

Base URL in local mode: `http://127.0.0.1:3001`. Every request except `/api/health` must send a bearer token. JSON bodies are limited to 20 KB at the HTTP boundary and action objects to 16 KB.

## Preview, approval, commit

1. `POST /api/actions/preview` returns a new action ID, action hash, preview token, risk factors, policy outcome, scenarios, and expiry.
2. For `REQUIRE_APPROVAL`, a distinct actor with role `approver` posts the returned `action_hash` to `/api/actions/:id/approve`.
3. The submitting actor posts that same `action_hash` and `preview_token` to `/api/actions/:id/commit` before expiry.
4. The receipt explicitly says `simulated: true`; the connector writes only to `mock_outbox`.

`BLOCK` is terminal for this lifecycle and cannot be approved. A changed hash, expired preview, missing approval, repeated idempotency key, or duplicate commit is rejected.

## Trace and evidence

Create a trace with `POST /api/traces` and `{ "objective": "...", "original_instruction": "...", "agent_id": "demo-agent" }`. Add events at `/api/traces/:id/events` with kind, source, content, and optional evidence status. Password/token-like values are redacted in recorded trace content. Add edges at `/api/traces/:id/edges`; `preceded` records ordering and does not assert causation. Fetch the resulting graph from `GET /api/traces/:id`.

## Policy, audit, alternatives, evaluation

- `POST /api/policies/evaluate` runs the independent policy and heuristic services without authorizing an action.
- `GET /api/policies/current` reports the active threshold and fixed mandatory blocks. An administrator can release a new threshold-only version with `POST /api/admin/policies` and `{ "version": "policy-v2", "approval_threshold": 55 }`. Releases are immutable; previews made under an earlier version cannot commit after a release.
- `GET /api/agents` lists registered agents. An administrator can create one with `POST /api/admin/agents` and `{ "agent_id": "worker-2", "permissions": ["file:read"] }`, or replace grants with `PUT /api/admin/agents/:id/permissions` and `{ "permissions": ["file:read"] }`. Preview checks that each requested action permission is granted to that agent.
- Preview responses include structured `risk.findings` such as sensitive-pattern, external-recipient, scope, prompt-injection, missing-evidence, intent-mismatch, and missing-recipient findings where applicable.
- `GET /api/traces/:id/risk` aggregates linked action scores as the maximum score plus 10% of remaining scores, capped at 100. This is a heuristic summary, not a probability.
- `GET /api/actions/:id/alternatives` evaluates deterministic counterfactual plans. A cancel plan is represented as `NO_ACTION`.
- `GET /api/actions/:id/recovery` returns a simulated recovery plan. `POST /api/actions/:id/verify` checks a mock receipt and its audit events. `GET /api/actions/:id/report` exports the stored evidence bundle.
- `GET /api/audit?limit=50&before=<seq>` returns actor-visible audit records. `GET /api/audit/verify` checks the stored hash chain.
- `POST /api/evaluations/run` requires an approver and runs the committed synthetic scenario set. `GET /api/evaluations/:id` returns persisted results.

Errors use JSON `{ "error": "...", "trace_id": "..." }`; request IDs are returned in `x-trace-id`. Health state does not claim LLM or learned-model availability.



## Queue, live events, and model comparison

- `GET /api/actions?status=AUTHORIZATION_PENDING&limit=50` lists actions visible to the caller. Operators see their own actions; approvers and admins can review all local demo actions.
- `GET /api/events` streams persisted audit events as Server-Sent Events. Send `Last-Event-ID` to resume; non-admin actors receive only their own events. This is SQLite polling for local mode, not Supabase Realtime.
- `POST /api/models/compare` accepts `{ "action": { ... } }`, records a comparison, and returns deterministic heuristic, optional LLM, and learned-model availability. The LLM adapter requires `LLM_API_URL`, `LLM_API_KEY`, and `LLM_MODEL`; it cannot override policy. The learned model remains unavailable until a labeled dataset and trained artifact are provided.

## Local sandbox

When the server runs outside production mode, it seeds the SQLite database with a small, synthetic trace and three representative actions (allowed, pending approval, and blocked). `GET /api/sandbox/session` returns the local demo role tokens only while sandbox mode is enabled. The local server binds to loopback; set `AEGIS_SANDBOX=false` to disable the sandbox session and seed behavior. No external service is called.

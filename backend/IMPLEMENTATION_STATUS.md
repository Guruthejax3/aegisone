# Implementation status

Last updated: 2026-10-24

## Implemented locally

- Stitch-inspired AegisOne security operations frontend served by the same Node process as its API, with backend health, action preview, approval queue, traces, audit, evaluations, model comparison, and settings.
- Versioned action validation, deterministic heuristic scoring, independent policy decisions, simulated consequence scenarios, and alternative plans.
- HMAC-bound preview and approval, expiry, separate approver, separation of duties, cancellation, idempotency protection, and mock-only commit receipts.
- SQLite persistence for actions, approvals, mock outbox, audit ledger, traces/evidence events, causal graph, alternatives, model comparisons, recovery plans, and evaluation runs/results.
- Action queue API with role-aware visibility and persisted Server-Sent Events with reconnect cursor.
- Optional OpenAI-compatible LLM comparison adapter with structured-output validation, timeout, explicit advisory-only role, and fail-closed unavailable states.
- Audit hash-chain verification, mock commit verification, recovery plan, evidence report, and structured anomalies.
- Agent permission registry, administrator-managed grants, immutable policy threshold releases, and invalidation of stale previews after policy changes.
- Loopback-only sandbox startup with stable local operator, approver, and admin roles; seeded SQLite examples include allowed, pending, and blocked actions, a provenance trace, and a verified audit chain. The frontend discovers sandbox credentials and signs in automatically. `.env.example`, API docs, Supabase/PostgreSQL schema starter, and tests are included.

## Uses sandbox data by default

Outside production, the server binds to `127.0.0.1`, provisions local demo tokens, and seeds the database once when no actions exist. Set `AEGIS_SANDBOX=false` to disable this. No sandbox data is sent to external services.\n\n## Requires external setup or remains incomplete

- Runtime is local SQLite with demo bearer tokens. Supabase Auth, runtime RLS, tenant isolation, Supabase Realtime, and hosted deployment are not connected or validated. The included SQL migration is a starting point, not a production-ready proof of isolation.
- Real email/file/API/database connectors are not configured. Commits only enter a mock outbox and do not perform external side effects.
- LLM comparison only becomes available when a compatible provider URL, key, and model are configured. Pattern redaction is incomplete and is not a privacy guarantee; do not send sensitive data without a provider-specific review.
- Supervised risk scoring is unavailable until labeled examples, a trained model, and validation metrics exist. The product reports this rather than inventing predictions.
- Evaluation cases are a small synthetic suite. Metrics describe those cases and do not establish security efficacy or model quality.
- Rate limiting is in-process. Production tenant isolation, durable realtime, secrets management, observability, backup/retention, deployment, and compliance review need infrastructure work.

## Verification

`npm test`: 13 passed, 0 failed. `node --check` for the browser client and Node TypeScript syntax checks passed. Tests use an in-memory SQLite database and invoke the handler directly; they do not validate external integrations, Supabase policies, deployment, or browser rendering.

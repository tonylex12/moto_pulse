# MotoPulse architecture

MotoPulse remains a modular monolith: one Expo client, one Go API and PostgreSQL.
This is deliberate. Features are separated by domain without adding distributed
systems overhead.

## Backend

- `main.go`: composition root, HTTP lifecycle and worker scheduling.
- `middleware/`: authentication and HTTP reliability concerns.
- `handlers/`: HTTP adapters and application use cases.
- `db/`: persistence models and ordered schema migrations.
- `scraper/` and `push/`: fallible external adapters.
- `BackgroundJob`: durable, idempotent PostgreSQL work queue. Workers claim rows
  with `FOR UPDATE SKIP LOCKED`, retry with exponential backoff and stop after a
  bounded number of attempts.

The API applies request-size and server timeouts, panic recovery, request IDs,
configurable CORS, readiness checks and graceful shutdown. `/health` reports
process health; `/ready` verifies database reachability.

## Mobile

- `features/garage`: shared vehicle domain state and models.
- `features/rides`: recoverable route persistence in bounded chunks.
- `components/ui`: reusable application primitives.
- `constants/design.ts`: semantic MotoPulse design tokens.
- route files under `app/`: composition and navigation only; new behavior should
  be extracted into the relevant feature instead of extending route files.

The active garage is a single shared source of truth. Route samples use a manifest
plus bounded chunks so adding a GPS point does not rewrite an ever-growing JSON
document. `AsyncStorage` remains a compatibility store; SQLite is the next storage
adapter when a native dependency upgrade is scheduled.

## Operational invariants

- At most one active vehicle per user.
- User-owned resources are checked server-side; client state is never trusted.
- Background work must be durable and idempotent.
- Device telemetry is labelled as measured, estimated or simulated.
- Shared routes should redact their first and last segment before publication.

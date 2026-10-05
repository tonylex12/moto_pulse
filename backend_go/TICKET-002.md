# Ticket #002 — Maintenance notifications

`isCompleted` records only user confirmation. `notifiedAt` records acceptance by
Expo for the current reminder cycle, not device delivery or user acknowledgement.
Changing the target, trigger type, last maintenance value, or reopening a completed
reminder clears `notifiedAt`. Changing its title does not resend a notification.

## Migration and deployment

The existing GORM `AutoMigrate` adds a nullable timestamp column at startup:

```sql
ALTER TABLE "MaintenanceAlert" ADD COLUMN IF NOT EXISTS "notifiedAt" timestamptz NULL;
```

There is no backfill or update to historical `isCompleted` values: we cannot infer
which records represent actual maintenance. Historical incomplete records remain
eligible when their condition is met. Stop old backend instances before deploying:
the old code conflates notifications with completion and does not use the row locks.

## Processing and guarantees

The scheduler checks dates (a seven-day window, including overdue reminders) and
persisted mileage every five minutes and shortly after startup. Fuel logs trigger
processing after successful commit; manual mileage updates trigger processing after
successful persistence. All paths share the same processor.

Each candidate is locked with `FOR UPDATE SKIP LOCKED` in a PostgreSQL transaction.
Completion, notification state, due conditions and push token are checked again
after locking. Concurrent workers skip the locked row. User edits acquire the same
row lock, preventing acceptance from an old cycle overwriting a newly configured one.

The HTTP request has a ten-second timeout. HTTP 200 alone is insufficient: the
single Expo ticket must have `status: ok` and a nonempty ID, without top-level errors.
Missing tokens and failed sends leave notifications pending. Failures are returned
or logged. Cron returns 503 without `CRON_SECRET`, 401 for incorrect credentials,
and 500 for processing errors. The internal scheduler does not require that secret.

Repeated scans do not resend a cycle after acceptance is successfully persisted.
**Delivery is not exactly once.** If Expo accepts a message and the database update
or commit fails, a retry can duplicate it. A timeout can also leave acceptance
uncertain. Expo and PostgreSQL do not share a transaction.

Limitations: a connection and row lock remain occupied during the bounded HTTP
call; retries are periodic without exponential backoff or an attempt limit. Invalid
tokens can continue failing until corrected. Receipt lookup and device delivery
tracking are not implemented. Date-only values retain UTC parsing. Large workloads
may need batching or a durable queue; no external queue has been added here.

## Tests

Run from `backend_go`:

```sh
go test ./... -count=1
go test -race ./... -count=1
go vet ./...
```

Integration tests require `TEST_DATABASE_URL` configured to a separate PostgreSQL
database whose name ends in `_test`. They explicitly skip when it is absent and
fail when a configured database is inaccessible. They reject the same endpoint
and database as an explicitly configured `DATABASE_URL`. Never use production
credentials. Each test creates and removes an isolated schema and opens independent
connection pools. No project `.env` is loaded by these tests.

The integration suite covers retries of both types, missing tokens, stale candidates,
cycle resets, historical migration, mileage triggers and deferred commit failure.
A database trigger demonstrates the duplicate window after accepted push and failed
persistence. The concurrent-worker test holds one worker in simulated HTTP push
while another skips the row and verifies a single acceptance without completion.

`TestPostgresConcurrentSendAndNewCycle` pauses a simulated push while an independent
connection attempts to change the target. It uses `pg_blocking_pids` to observe an
actual PostgreSQL lock wait, then releases push and waits for both workers. The final
target is preserved, `notifiedAt` is NULL and `isCompleted` remains false. Channels,
timeouts and cleanup ordering ensure workers finish before database cleanup.

These tests were executed with PostgreSQL 16 in a dedicated disposable database,
including the race detector. They do not send real Expo notifications.

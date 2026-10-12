# Offline-first behavior

MotoPulse treats the local store as the availability layer and PostgreSQL as the
remote authority. Native builds use `expo-sqlite` with WAL enabled. Web uses the
same cache/outbox contract through AsyncStorage because Expo SQLite web support
still requires cross-origin isolation and remains less mature.

## Supported offline

- Read previously synchronized vehicles, fuel logs, statistics, alerts and routes.
- Create and edit vehicles, fuel logs, alerts and route metadata.
- Delete locally cached entities and replay the deletion later.
- Record GPS points incrementally in SQLite and recover an interrupted recording.
- Associate local route videos and use device sensors/camera.

Search/geocoding and OSRM route calculation remain online-only. The UI disables
destination search while offline, but GPS route recording remains available.

## Synchronization contract

Every mutation receives an `Idempotency-Key` before its first network attempt.
If connectivity is absent or uncertain, the exact request and key are persisted
in `sync_outbox`. Replay is ordered and stops at the first failure to preserve
dependencies such as vehicle creation before fuel-log creation.

The backend stores the response associated with each authenticated user/key pair.
Repeating a completed operation returns the stored response and cannot create a
duplicate. Client-generated UUIDs remain stable from local creation through the
server write.

After a successful outbox drain, `/api/sync/pull` refreshes the local snapshot.
The endpoint accepts a timestamp cursor for future incremental synchronization.
Deletion tombstones and automatic cross-device conflict resolution are not yet
enabled; this release targets resilient single-device offline operation.

## Privacy

Offline data is tied to the current authenticated installation. Signing out clears
the response cache, pending operations and active route data. The dashboard warns
before sign-out when unsynchronized operations exist.

## Storage tables

- `response_cache`: normalized API read cache.
- `sync_outbox`: durable ordered mutations and retry metadata.
- `sync_state`: reserved for cursors and migration state.
- `active_route`: active recording metadata.
- `active_route_points`: append-only GPS samples for the active recording.

The previous chunked AsyncStorage route format is imported automatically on first
read and removed only after the SQLite write succeeds.

# MotoPulse

MotoPulse helps motorcycle owners organize their vehicles, fuel expenses,
maintenance reminders and recorded rides in one mobile app. It is a personal
project in active development, tested by its author, with no external users.
It is a learning and portfolio project focused on React Native, Expo and Go.
The interface is primarily in Spanish.

## Implemented features

| Area | Implemented functionality |
| --- | --- |
| Account and garage | Clerk sign-up, email verification and sign-in; authenticated API requests; vehicle creation, editing, deletion and active-vehicle selection. |
| Fuel tracking | Fuel logs with odometer readings, liters, cost and dates; consumption summaries and charts. |
| Maintenance | Date and mileage reminders, user confirmation and cycle reset; server-side push processing, periodic retries and an authenticated cron trigger. |
| Rides and recordings | GPS route recording, distance, saved routes and active-recording recovery; maps, destination search and routing; local camera recordings and playback with route telemetry. |
| Dashboard and vehicle information | Light/dark themes, accelerometer lean estimation and calibration, simulated telemetry and a web map/simulator; best-effort specification/image lookup and manual editing. |

These features are implemented in code, with device setup and validation limits
described below. Dashboard speed, RPM and gears are simulated; route-card altitude
curves are decorative. The web simulator does not demonstrate native GPS recording.

## Stack and architecture

| Component | Technologies and responsibilities |
| --- | --- |
| `mobile/` | React Native 0.86.2, Expo SDK 57, React 19, TypeScript, Expo Router and NativeWind. Screens, permissions, GPS, sensors, camera and API calls. |
| `backend_go/` | Go 1.26.5, Chi, GORM and PostgreSQL. Authentication, ownership checks, REST handlers, persistence, scraping and reminder processing. |
| Authentication | Clerk sessions on mobile; JWT signature verification against configured Clerk JWKS on the server. Native token storage uses Expo SecureStore. |
| Local persistence | AsyncStorage for theme preferences, active route data and local route/video associations. |
| External integrations | Expo Push Service, web search for vehicle data, and map/search/routing providers. |

```mermaid
flowchart LR
    Mobile["Mobile · React Native / Expo Router"] -->|Session| Clerk["Clerk"]
    Mobile -->|REST · Bearer JWT| API["Backend · Go / Chi"]
    API -->|GORM| DB[(PostgreSQL)]
    API -->|JWKS verification| Clerk
    API --> Push["Expo Push Service"]
    API --> Lookup["Vehicle specification / image lookup"]
    Mobile --> Device["GPS · sensors · camera · local storage"]
    Mobile --> Maps["Map / search / routing providers"]
```

`mobile/app/` contains authentication and tab routes; `hooks/` handles device
features; `utils/` contains the HTTP client, token cache and UI contexts.
`backend_go/main.go` wires routes and the scheduler; `middleware/` validates
authentication; `handlers/` contains request and business logic; `db/` defines
models; `push/` and `scraper/` handle external calls. This is a single backend
process, not a microservice system. GORM currently migrates the schema at startup.

## Run locally

Requirements: Go 1.26.5 or a compatible newer toolchain, PostgreSQL, Node.js
compatible with Expo SDK 57 and npm. Docker is optional for local PostgreSQL.
Native Android builds need the Android SDK/JDK; local iOS builds need macOS/Xcode.
Use your own Clerk instance with email/password sign-in and email verification
configured. Public-key values below are placeholders and must be replaced.

### Backend

For a disposable development database, from the repository root:

```sh
docker run --rm -d --name motopulse-dev-db \
  -e POSTGRES_USER=motopulse_dev -e POSTGRES_PASSWORD=local_dev_only \
  -e POSTGRES_DB=motopulse_dev -p 127.0.0.1:5432:5432 postgres:16-alpine
```

The password above is a public, local-only example, not a deployment credential.
Wait until PostgreSQL is ready. Create your own `backend_go/.env`:

```dotenv
DATABASE_URL=postgres://motopulse_dev:local_dev_only@localhost:5432/motopulse_dev?sslmode=disable
CLERK_PUBLISHABLE_KEY=<publishable-key-from-your-Clerk-instance>
PORT=3000
CRON_SECRET=<your-own-random-cron-secret>
```

| Backend variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection string. Startup runs migrations. |
| `CLERK_PUBLISHABLE_KEY` | Required valid Clerk publishable key; determines the trusted issuer. |
| `PORT` | Optional; defaults to `3000`. |
| `CRON_SECRET` | Required only to enable the external cron endpoint; the internal scheduler still runs without it. |
| `TEST_DATABASE_URL` | Used only by integration tests; must identify a separate database ending in `_test`. |

The current backend does not read `CLERK_SECRET_KEY` or `GEMINI_API_KEY`.
`GO_ENV` does not relax authentication. Use local configuration you control;
never commit real secrets or copy credentials from another environment.

```sh
cd backend_go
go mod download
go run .
```

In another terminal, `curl http://localhost:3000/health` checks the HTTP server.
Protected endpoints are under `/api` and require a Clerk session token.
`POST /api/cron/check-alerts` requires `Authorization: Bearer <CRON_SECRET>`;
without the configured secret it returns `503`, and wrong credentials return `401`.

### Mobile

Create `mobile/.env` using the same Clerk instance as the backend:

```dotenv
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<same-Clerk-publishable-key-as-the-backend>
EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:3000/api
```

`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is needed for authentication.
`EXPO_PUBLIC_API_URL` is optional: the client otherwise derives the Expo host's
address and uses port 3000, or falls back to localhost. An explicit URL is clearer
on devices; `/api` is appended when omitted. Public Expo variables are bundled
into the app: never put server secrets in them.

```sh
cd mobile
npm ci
npm start
```

The backend must be reachable from the device. A phone's `localhost` is the phone,
not your computer. Android emulators commonly use `10.0.2.2` for the host machine.
For a web preview use `npm run web`; it does not demonstrate native background
GPS or push behavior. Restart Metro after changing environment configuration.

### Native device setup

Use a development build to evaluate background GPS and remote push. Android
background location flags are configured; iOS background mode and EAS push setup
still need configuration. The app registers push tokens only on physical devices.

Follow [Native setup](docs/native-setup.md) for build commands, platform permissions,
notification credentials and the exact configuration missing from this checkout.
Expo Go and the web preview do not cover the full native workflow.

## Tests

From `backend_go`, with `TEST_DATABASE_URL` unset, run unit tests and static checks:

```sh
go test ./... -count=1
go test -race ./... -count=1
go vet ./...
```

PostgreSQL integration tests explicitly skip when `TEST_DATABASE_URL` is absent.
A passing command without that variable does not prove database concurrency.
For the full suite, start a **separate disposable test database**:

```sh
docker run --rm -d --name motopulse-test-db \
  -e POSTGRES_USER=motopulse_test -e POSTGRES_PASSWORD=local_test_only \
  -e POSTGRES_DB=motopulse_alerts_test -p 127.0.0.1:55432:5432 postgres:16-alpine
docker exec motopulse-test-db pg_isready -U motopulse_test -d motopulse_alerts_test
```

Wait for the readiness check to succeed, then from `backend_go`:

```sh
export TEST_DATABASE_URL='postgres://motopulse_test:local_test_only@127.0.0.1:55432/motopulse_alerts_test?sslmode=disable'
go test ./... -count=1
go test -race ./... -count=1
go vet ./...
docker stop motopulse-test-db
```

The suite creates and removes an isolated schema per integration test. The database
name must end in `_test`; it rejects a match with an explicitly configured
`DATABASE_URL`. These checks are safeguards, not a substitute for a dedicated test
database. Startup tests avoid loading the project's `.env`.

Coverage includes trusted-issuer rejection without JWKS requests, failed startup,
push ticket validation, reminder eligibility, cron access, retries, cycle reset,
historical-state preservation, mileage triggers, rollback and PostgreSQL locking.
Concurrent tests exercise both competing processors and a cycle edit waiting
behind an in-progress send. These PostgreSQL tests have been executed with the race
detector against a dedicated PostgreSQL 16 instance; push is simulated.

For mobile type checking, run `npx tsc --noEmit` from `mobile`.
There is currently no automated mobile unit or end-to-end test suite. No claim is
made here about a completed device/platform manual-testing matrix.

## Technical decisions

**Authentication uses a configured trust boundary.** Startup requires a valid Clerk
publishable key. The backend derives an exact HTTPS issuer, rejects a different
`iss` in every environment before fetching keys, and fetches JWKS only from that
configured issuer without following redirects. `jwt.WithIssuer` also checks the
issuer during verification; user identity comes from verified claims. A valid
signature from an unrelated issuer cannot authenticate a MotoPulse user.

**Notification acceptance is separate from maintenance completion.** `notifiedAt`
means Expo accepted a reminder; `isCompleted` means the user confirmed maintenance.
The shared processor rechecks conditions under `FOR UPDATE SKIP LOCKED` and retries
pending reminders. Cycle edits use the same row lock and clear notification state
for the new cycle. The nullable column is added by AutoMigrate without changing
historical completion flags. See [Ticket #002](backend_go/TICKET-002.md) for details.

## Known limitations

- **Simulated data:** dashboard speed, RPM and gears, plus decorative altitude curves,
  are not measured telemetry. Accelerometer lean is an estimate; devices without
  that sensor can save simulated maxima. Videos remain local to the device.
- **Native setup:** iOS background location and EAS push configuration are pending.
  Android notification-channel creation order also needs review. See
  [Native setup](docs/native-setup.md); simulated backend sends do not prove device delivery.
- **Validation:** backend PostgreSQL concurrency tests have run with the race detector
  and a simulated push sender. Mobile has no automated unit/end-to-end suite or
  completed device/platform testing matrix. Integration tests skip without
  `TEST_DATABASE_URL`; the project has no external users or store publication.
- **Duplicate notifications remain possible:** Expo can accept a push before a
  database update/commit fails, causing a retry to send again. Timeouts can leave
  acceptance uncertain. Receipts/device delivery are not tracked; sending holds
  a row lock and connection. Retries have no backoff or attempt limit.
- **Data consistency:** historical completion flags cannot be reclassified safely;
  date-only reminders use UTC. Fuel summaries and charts use different refill
  intervals, and active-vehicle copies can require manual refresh.
- **Further hardening:** vehicle scraping and public map services are fallible.
  Large screens combine UI, network and device logic; validation, production
  CORS/server hardening and mobile test coverage need further work.

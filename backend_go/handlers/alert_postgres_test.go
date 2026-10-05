package handlers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"backend_go/db"
	"backend_go/middleware"
	"backend_go/push"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// Only an explicitly supplied, separately named test database is ever migrated.
// Every test uses an isolated schema and two independent connection pools.
func postgresTestDB(t *testing.T) (*gorm.DB, *gorm.DB) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("PostgreSQL integration test not executed: TEST_DATABASE_URL is unset")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid TEST_DATABASE_URL")
	}
	if !strings.HasSuffix(config.Database, "_test") {
		t.Fatal("test database name must end in _test")
	}
	if production := os.Getenv("DATABASE_URL"); production != "" {
		p, err := pgx.ParseConfig(production)
		if err != nil {
			t.Fatal("cannot establish separation from DATABASE_URL")
		}
		if p.Host == config.Host && p.Port == config.Port && p.Database == config.Database {
			t.Fatal("TEST_DATABASE_URL must not point to DATABASE_URL")
		}
	}
	admin := stdlib.OpenDB(*config)
	if err := admin.Ping(); err != nil {
		admin.Close()
		t.Fatalf("cannot connect to separate PostgreSQL test database: %v", err)
	}
	schema := "ticket002_" + strings.ReplaceAll(db.GenerateUUID(), "-", "")
	if _, err := admin.Exec(`CREATE SCHEMA "` + schema + `"`); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(`DROP SCHEMA "` + schema + `" CASCADE`); err != nil {
			t.Errorf("cleanup schema: %v", err)
		}
		admin.Close()
	})
	config.RuntimeParams["search_path"] = schema
	open := func() *gorm.DB {
		pool := stdlib.OpenDB(*config)
		pool.SetMaxOpenConns(4)
		t.Cleanup(func() { pool.Close() })
		database, err := gorm.Open(postgres.New(postgres.Config{Conn: pool}), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal(err)
		}
		return database
	}
	a, b := open(), open()
	if err := a.AutoMigrate(&db.User{}, &db.Vehicle{}, &db.FuelLog{}, &db.MaintenanceAlert{}); err != nil {
		t.Fatal(err)
	}
	return a, b
}

func alertFixture(t *testing.T, database *gorm.DB, kind db.TriggerType, target string, token *string, completed bool) db.MaintenanceAlert {
	t.Helper()
	user := db.User{ClerkID: db.GenerateUUID(), Email: "test@example.test", ExpoPushToken: token}
	if err := database.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	vehicle := db.Vehicle{UserID: user.ClerkID, Brand: "Test", Model: "Moto", Year: 2026, CurrentMileage: 100}
	if err := database.Omit(clause.Associations).Create(&vehicle).Error; err != nil {
		t.Fatal(err)
	}
	alert := db.MaintenanceAlert{VehicleID: vehicle.ID, Title: "Test maintenance", Type: db.OilChange, TriggerType: kind, TriggerValue: target, IsCompleted: completed}
	if err := database.Omit(clause.Associations).Create(&alert).Error; err != nil {
		t.Fatal(err)
	}
	return alert
}

func readAlert(t *testing.T, database *gorm.DB, id string) db.MaintenanceAlert {
	t.Helper()
	var alert db.MaintenanceAlert
	if err := database.First(&alert, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return alert
}

func TestPostgresAlertsRetryBothTypes(t *testing.T) {
	database, _ := postgresTestDB(t)
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	token := "ExponentPushToken[test]"
	for _, kind := range []db.TriggerType{db.TriggerDate, db.TriggerMileage} {
		target := "100"
		if kind == db.TriggerDate {
			target = "2026-10-04"
		}
		alert := alertFixture(t, database, kind, target, &token, false)
		calls := 0
		fail := func(string, string, string, map[string]interface{}) error {
			calls++
			return errors.New("push rejected")
		}
		if err := processPendingAlerts(database, alert.VehicleID, fail, now); err == nil {
			t.Fatal("push failure lost")
		}
		stored := readAlert(t, database, alert.ID)
		if stored.IsCompleted || stored.NotifiedAt != nil {
			t.Fatal("failed push changed maintenance or notification state")
		}
		accept := func(string, string, string, map[string]interface{}) error { calls++; return nil }
		// Global scheduler retries mileage even when there is no new fuel log.
		if err := processPendingAlerts(database, "", accept, now); err != nil {
			t.Fatal(err)
		}
		stored = readAlert(t, database, alert.ID)
		if stored.IsCompleted || stored.NotifiedAt == nil {
			t.Fatal("acceptance must notify without completing")
		}
		if err := processPendingAlerts(database, "", accept, now); err != nil {
			t.Fatal(err)
		}
		if calls != 2 {
			t.Fatalf("push calls=%d, want one failure and one acceptance", calls)
		}
	}
}

func TestPostgresAlertsMissingTokenAndStaleCandidates(t *testing.T) {
	database, _ := postgresTestDB(t)
	now := time.Now()
	token := "ExponentPushToken[test]"
	missing := alertFixture(t, database, db.TriggerMileage, "100", nil, false)
	completed := alertFixture(t, database, db.TriggerMileage, "100", &token, true)
	notified := alertFixture(t, database, db.TriggerMileage, "100", &token, false)
	if err := database.Model(&notified).Update("notifiedAt", now).Error; err != nil {
		t.Fatal(err)
	}
	future := alertFixture(t, database, db.TriggerMileage, "101", &token, false)
	for _, alert := range []db.MaintenanceAlert{missing, completed, notified, future} {
		if err := processAlert(database, alert.ID, func(string, string, string, map[string]interface{}) error {
			t.Error("ineligible alert sent")
			return nil
		}, now); err != nil {
			t.Fatal(err)
		}
	}
	if stored := readAlert(t, database, missing.ID); stored.IsCompleted || stored.NotifiedAt != nil {
		t.Fatal("missing token should remain pending")
	}
}

type simulatedPushTransport func(*http.Request) (*http.Response, error)

func (f simulatedPushTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPostgresConcurrentAlertsSkipLocked(t *testing.T) {
	a, b := postgresTestDB(t)
	token := "ExponentPushToken[test]"
	alert := alertFixture(t, a, db.TriggerMileage, "100", &token, false)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	var calls atomic.Int32
	client := push.Client{Endpoint: "https://simulated-push.test/send", HTTP: &http.Client{Transport: simulatedPushTransport(func(r *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			close(entered)
		}
		select {
		case <-release:
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"data":[{"status":"ok","id":"ticket-1"}]}`))}, nil
	})}}
	done := make(chan error, 1)
	go func() { done <- processPendingAlerts(a, "", client.Send, time.Now()) }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("first worker did not reach simulated push")
	}
	second := make(chan error, 1)
	go func() { second <- processPendingAlerts(b, "", client.Send, time.Now()) }()
	select {
	case err := <-second:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("second worker blocked instead of skipping the row")
	}
	if calls.Load() != 1 {
		t.Fatalf("concurrent sends=%d", calls.Load())
	}
	unblock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := processPendingAlerts(b, "", client.Send, time.Now()); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("persisted acceptance sent again")
	}
	stored := readAlert(t, a, alert.ID)
	if stored.NotifiedAt == nil || stored.IsCompleted {
		t.Fatal("incorrect final state")
	}
}

func TestPostgresConcurrentSendAndNewCycle(t *testing.T) {
	a, b := postgresTestDB(t)
	token := "ExponentPushToken[test]"
	alert := alertFixture(t, a, db.TriggerMileage, "100", &token, false)
	var vehicle db.Vehicle
	if err := a.First(&vehicle, "id = ?", alert.VehicleID).Error; err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	entered, release, startEdit := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	processorDone, editorDone := make(chan error, 1), make(chan error, 1)
	editorPID := make(chan int, 1)
	var workers sync.WaitGroup
	workers.Add(2)
	workersDone := make(chan struct{})
	// Registered after postgresTestDB: drain workers before pools/schema cleanup.
	t.Cleanup(func() {
		unblock()
		cancel()
		select {
		case <-workersDone:
		case <-time.After(12 * time.Second):
			t.Fatal("workers did not terminate before database cleanup")
		}
	})

	client := push.Client{Endpoint: "https://simulated-push.test/send", HTTP: &http.Client{Transport: simulatedPushTransport(func(r *http.Request) (*http.Response, error) {
		close(entered) // processAlert already owns the alert's row lock.
		select {
		case <-release:
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"data":[{"status":"ok","id":"ticket-cycle"}]}`))}, nil
	})}}
	go func() {
		defer workers.Done()
		processorDone <- processAlert(a.WithContext(ctx), alert.ID, client.Send, time.Now())
	}()
	go func() {
		defer workers.Done()
		select {
		case <-startEdit:
		case <-ctx.Done():
			editorDone <- ctx.Err()
			return
		}
		editorDone <- b.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var pid int
			if err := tx.Raw("SELECT pg_backend_pid()").Scan(&pid).Error; err != nil {
				return err
			}
			editorPID <- pid
			target := "200"
			_, err := updateMaintenanceAlert(tx, alert.ID, vehicle.UserID, UpdateAlertInput{TriggerValue: &target})
			return err
		})
	}()
	go func() { workers.Wait(); close(workersDone) }()

	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("processor did not enter simulated push")
	}
	close(startEdit)
	var pid int
	select {
	case pid = <-editorPID:
	case <-ctx.Done():
		t.Fatal("editor did not start its independent transaction")
	}

	// Observe an actual PostgreSQL lock wait, not merely a slow goroutine.
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var blocked bool
		if err := a.WithContext(ctx).Raw("SELECT cardinality(pg_blocking_pids(?)) > 0", pid).Scan(&blocked).Error; err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		select {
		case err := <-editorDone:
			t.Fatalf("editor finished before push released the row: %v", err)
		case <-ctx.Done():
			t.Fatal("PostgreSQL did not report the editor waiting on the row lock")
		case <-ticker.C:
		}
	}
	select {
	case err := <-editorDone:
		t.Fatalf("editor completed while push still held the lock: %v", err)
	case <-time.After(100 * time.Millisecond):
	}

	unblock()
	for name, done := range map[string]<-chan error{"processor": processorDone, "editor": editorDone} {
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("%s failed: %v", name, err)
			}
		case <-ctx.Done():
			t.Fatalf("%s did not finish after releasing push", name)
		}
	}
	select {
	case <-workersDone:
	case <-ctx.Done():
		t.Fatal("workers did not exit")
	}
	stored := readAlert(t, a, alert.ID)
	if stored.TriggerValue != "200" || stored.NotifiedAt != nil || stored.IsCompleted {
		t.Fatalf("new cycle lost: target=%q, notifiedAt=%v, completed=%v", stored.TriggerValue, stored.NotifiedAt, stored.IsCompleted)
	}
}

func TestPostgresNewCycleAndCompletion(t *testing.T) {
	database, _ := postgresTestDB(t)
	token := "ExponentPushToken[test]"
	now := time.Now()
	alert := alertFixture(t, database, db.TriggerMileage, "100", &token, false)
	if err := database.Model(&alert).Update("notifiedAt", now).Error; err != nil {
		t.Fatal(err)
	}
	update := func(input UpdateAlertInput) {
		t.Helper()
		var vehicle db.Vehicle
		if err := database.First(&vehicle, "id = ?", alert.VehicleID).Error; err != nil {
			t.Fatal(err)
		}
		if err := database.Transaction(func(tx *gorm.DB) error {
			_, err := updateMaintenanceAlert(tx, alert.ID, vehicle.UserID, input)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	title := "Renamed"
	update(UpdateAlertInput{Title: &title})
	if readAlert(t, database, alert.ID).NotifiedAt == nil {
		t.Fatal("renaming must not rearm")
	}
	completed := true
	update(UpdateAlertInput{IsCompleted: &completed})
	stored := readAlert(t, database, alert.ID)
	if !stored.IsCompleted || stored.NotifiedAt == nil {
		t.Fatal("user completion lost")
	}
	target, last := "200", "100"
	completed = false
	update(UpdateAlertInput{TriggerValue: &target, LastPerformedValue: &last, IsCompleted: &completed})
	stored = readAlert(t, database, alert.ID)
	if stored.IsCompleted || stored.NotifiedAt != nil || stored.TriggerValue != "200" {
		t.Fatal("new cycle not rearmed")
	}
}

func TestPostgresAcceptedPushThenSaveFailureRemainsPending(t *testing.T) {
	database, _ := postgresTestDB(t)
	token := "ExponentPushToken[test]"
	alert := alertFixture(t, database, db.TriggerMileage, "100", &token, false)
	if err := database.Exec(`CREATE FUNCTION reject_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."notifiedAt" IS NOT NULL THEN RAISE EXCEPTION 'simulated save failure'; END IF; RETURN NEW; END $$`).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(`CREATE TRIGGER reject_notification BEFORE UPDATE ON "MaintenanceAlert" FOR EACH ROW EXECUTE FUNCTION reject_notification()`).Error; err != nil {
		t.Fatal(err)
	}
	calls := 0
	send := func(string, string, string, map[string]interface{}) error { calls++; return nil }
	if err := processAlert(database, alert.ID, send, time.Now()); err == nil {
		t.Fatal("save failure ignored")
	}
	stored := readAlert(t, database, alert.ID)
	if stored.NotifiedAt != nil || stored.IsCompleted {
		t.Fatal("failed transaction persisted state")
	}
	if err := database.Exec(`DROP TRIGGER reject_notification ON "MaintenanceAlert"`).Error; err != nil {
		t.Fatal(err)
	}
	if err := processAlert(database, alert.ID, send, time.Now()); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("expected potential duplicate after failed persistence")
	}
}

func TestPostgresMigrationPreservesHistoricalStates(t *testing.T) {
	database, _ := postgresTestDB(t)
	completed := alertFixture(t, database, db.TriggerMileage, "100", nil, true)
	pending := alertFixture(t, database, db.TriggerMileage, "100", nil, false)
	if err := database.Migrator().DropColumn(&db.MaintenanceAlert{}, "NotifiedAt"); err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&db.MaintenanceAlert{}); err != nil {
		t.Fatal(err)
	}
	a, b := readAlert(t, database, completed.ID), readAlert(t, database, pending.ID)
	if !a.IsCompleted || b.IsCompleted || a.NotifiedAt != nil || b.NotifiedAt != nil {
		t.Fatal("migration reinterpreted historical states")
	}
}

func authenticatedRequest(method, path, body, userID, id string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	ctx := context.WithValue(req.Context(), middleware.ClerkUserKey, userID)
	route := chi.NewRouteContext()
	route.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(ctx, chi.RouteCtxKey, route))
}

func TestPostgresMileageHandlersPersistThenNotify(t *testing.T) {
	database, _ := postgresTestDB(t)
	previous := db.DB
	db.DB = database
	t.Cleanup(func() { db.DB = previous })
	token := "ExponentPushToken[test]"
	alert := alertFixture(t, database, db.TriggerMileage, "150", &token, false)
	var vehicle db.Vehicle
	if err := database.First(&vehicle, "id = ?", alert.VehicleID).Error; err != nil {
		t.Fatal(err)
	}
	previousTransport := http.DefaultTransport
	events := make(chan int, 2)
	http.DefaultTransport = simulatedPushTransport(func(*http.Request) (*http.Response, error) {
		var persisted db.Vehicle
		if err := database.First(&persisted, "id = ?", vehicle.ID).Error; err != nil {
			return nil, err
		}
		events <- persisted.CurrentMileage
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"data":[{"status":"ok","id":"ticket-1"}]}`))}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = previousTransport })
	wait := func(mileage int) {
		t.Helper()
		select {
		case got := <-events:
			if got != mileage {
				t.Errorf("push observed mileage %d, want %d", got, mileage)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("saved mileage did not trigger a push")
		}
		deadline := time.Now().Add(5 * time.Second)
		for readAlert(t, database, alert.ID).NotifiedAt == nil {
			if time.Now().After(deadline) {
				t.Fatal("push acceptance was not committed")
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	res := httptest.NewRecorder()
	CreateFuelLog(res, authenticatedRequest("POST", "/", `{"vehicleId":"`+vehicle.ID+`","odometer":150,"liters":5,"price":20}`, vehicle.UserID, ""))
	if res.Code != 201 {
		t.Fatalf("fuel log status=%d", res.Code)
	}
	wait(150)
	res = httptest.NewRecorder()
	UpdateAlert(res, authenticatedRequest("PUT", "/", `{"triggerValue":"200","lastPerformedValue":"150","isCompleted":false}`, vehicle.UserID, alert.ID))
	if res.Code != 200 {
		t.Fatalf("new cycle status=%d", res.Code)
	}
	res = httptest.NewRecorder()
	UpdateVehicle(res, authenticatedRequest("PUT", "/", `{"currentMileage":200}`, vehicle.UserID, vehicle.ID))
	if res.Code != 200 {
		t.Fatalf("vehicle update status=%d", res.Code)
	}
	wait(200)
}

func TestPostgresFuelCommitFailureDoesNotNotify(t *testing.T) {
	database, _ := postgresTestDB(t)
	previous := db.DB
	db.DB = database
	t.Cleanup(func() { db.DB = previous })
	token := "ExponentPushToken[test]"
	alert := alertFixture(t, database, db.TriggerMileage, "150", &token, false)
	var vehicle db.Vehicle
	if err := database.First(&vehicle, "id = ?", alert.VehicleID).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(`CREATE FUNCTION reject_fuel_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated commit failure'; END $$`).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(`CREATE CONSTRAINT TRIGGER reject_fuel_commit AFTER INSERT ON "FuelLog" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_fuel_commit()`).Error; err != nil {
		t.Fatal(err)
	}
	previousTransport := http.DefaultTransport
	var calls atomic.Int32
	http.DefaultTransport = simulatedPushTransport(func(*http.Request) (*http.Response, error) { calls.Add(1); return nil, errors.New("must not send") })
	t.Cleanup(func() { http.DefaultTransport = previousTransport })
	res := httptest.NewRecorder()
	CreateFuelLog(res, authenticatedRequest("POST", "/", `{"vehicleId":"`+vehicle.ID+`","odometer":150,"liters":5,"price":20}`, vehicle.UserID, ""))
	if res.Code != 500 {
		t.Fatalf("failed commit status=%d", res.Code)
	}
	if err := database.First(&vehicle, "id = ?", vehicle.ID).Error; err != nil || vehicle.CurrentMileage != 100 {
		t.Fatal("failed transaction changed mileage")
	}
	var count int64
	if err := database.Model(&db.FuelLog{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("failed transaction persisted fuel log")
	}
	if calls.Load() != 0 || readAlert(t, database, alert.ID).NotifiedAt != nil {
		t.Fatal("failed commit triggered notification")
	}
}

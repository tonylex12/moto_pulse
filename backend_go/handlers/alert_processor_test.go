package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"backend_go/db"
)

func TestAlertDue(t *testing.T) {
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name                      string
		kind                      db.TriggerType
		value                     string
		mileage                   int
		completed, notified, want bool
	}{
		{"mileage before", db.TriggerMileage, "100", 99, false, false, false},
		{"mileage equal", db.TriggerMileage, "100", 100, false, false, true},
		{"mileage after", db.TriggerMileage, "100", 101, false, false, true},
		{"invalid mileage", db.TriggerMileage, "bad", 100, false, false, false},
		{"negative mileage", db.TriggerMileage, "-1", 100, false, false, false},
		{"date boundary", db.TriggerDate, now.AddDate(0, 0, 7).Format(time.RFC3339), 0, false, false, true},
		{"date outside", db.TriggerDate, now.AddDate(0, 0, 7).Add(time.Second).Format(time.RFC3339), 0, false, false, false},
		{"date overdue", db.TriggerDate, "2026-10-01", 0, false, false, true},
		{"invalid date", db.TriggerDate, "bad", 0, false, false, false},
		{"completed", db.TriggerMileage, "100", 100, true, false, false},
		{"notified", db.TriggerMileage, "100", 100, false, true, false},
		{"unknown", db.TriggerType("UNKNOWN"), "100", 100, false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			alert := db.MaintenanceAlert{TriggerType: tc.kind, TriggerValue: tc.value, IsCompleted: tc.completed, Vehicle: db.Vehicle{CurrentMileage: tc.mileage}}
			if tc.notified {
				alert.NotifiedAt = &now
			}
			if got := alertDue(alert, now); got != tc.want {
				t.Errorf("due=%v, want %v", got, tc.want)
			}
		})
	}
}

func TestCronFailsClosed(t *testing.T) {
	// A nil DB would panic if an unauthorized request reached processing.
	previous := db.DB
	db.DB = nil
	t.Cleanup(func() { db.DB = previous })
	for _, tc := range []struct {
		secret, header string
		status         int
	}{
		{"", "", 503}, {"", "Bearer anything", 503}, {"test-secret", "", 401}, {"test-secret", "Bearer wrong", 401},
	} {
		t.Setenv("CRON_SECRET", tc.secret)
		req := httptest.NewRequest(http.MethodPost, "/api/cron/check-alerts", nil)
		req.Header.Set("Authorization", tc.header)
		response := httptest.NewRecorder()
		TriggerCronCheckAlerts(response, req)
		if response.Code != tc.status {
			t.Errorf("status=%d, want %d", response.Code, tc.status)
		}
	}
}

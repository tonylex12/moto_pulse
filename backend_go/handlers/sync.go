package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"backend_go/db"
	"backend_go/middleware"
)

// PullChanges returns a consistent domain snapshot, optionally filtered by a
// server-issued timestamp cursor. Deletion tombstones will be added when
// cross-device deletion is enabled; current offline clients push their own deletes.
func PullChanges(w http.ResponseWriter, r *http.Request) {
	userID, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}
	serverTime := time.Now().UTC()
	var since time.Time
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		parsed, parseErr := time.Parse(time.RFC3339Nano, raw)
		if parseErr != nil {
			http.Error(w, `{"error":"Invalid sync cursor"}`, http.StatusBadRequest)
			return
		}
		since = parsed
	}

	var vehicles []db.Vehicle
	vehicleQuery := db.DB.Where(`"userId" = ?`, userID)
	if !since.IsZero() {
		vehicleQuery = vehicleQuery.Where(`"updatedAt" > ?`, since)
	}
	if err := vehicleQuery.Find(&vehicles).Error; err != nil {
		http.Error(w, `{"error":"Failed to sync vehicles"}`, http.StatusInternalServerError)
		return
	}

	var vehicleIDs []string
	if err := db.DB.Model(&db.Vehicle{}).Where(`"userId" = ?`, userID).Pluck("id", &vehicleIDs).Error; err != nil {
		http.Error(w, `{"error":"Failed to sync"}`, http.StatusInternalServerError)
		return
	}
	var fuelLogs []db.FuelLog
	var alerts []db.MaintenanceAlert
	if len(vehicleIDs) > 0 {
		fuelQuery := db.DB.Where(`"vehicleId" IN ?`, vehicleIDs)
		alertQuery := db.DB.Where(`"vehicleId" IN ?`, vehicleIDs)
		if !since.IsZero() {
			fuelQuery = fuelQuery.Where(`"updatedAt" > ?`, since)
			alertQuery = alertQuery.Where(`"updatedAt" > ?`, since)
		}
		if err := fuelQuery.Find(&fuelLogs).Error; err != nil {
			http.Error(w, `{"error":"Failed to sync fuel logs"}`, http.StatusInternalServerError)
			return
		}
		if err := alertQuery.Find(&alerts).Error; err != nil {
			http.Error(w, `{"error":"Failed to sync alerts"}`, http.StatusInternalServerError)
			return
		}
	}
	var routes []db.SavedRoute
	routeQuery := db.DB.Where(`"userId" = ?`, userID)
	if !since.IsZero() {
		routeQuery = routeQuery.Where(`"updatedAt" > ?`, since)
	}
	if err := routeQuery.Find(&routes).Error; err != nil {
		http.Error(w, `{"error":"Failed to sync routes"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"cursor": serverTime.Format(time.RFC3339Nano), "vehicles": vehicles, "fuelLogs": fuelLogs, "alerts": alerts, "routes": routes,
	})
}

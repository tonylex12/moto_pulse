package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"backend_go/db"
	"backend_go/middleware"
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type CreateAlertInput struct {
	VehicleID          string         `json:"vehicleId"`
	Type               db.AlertType   `json:"type"`
	Title              string         `json:"title"`
	TriggerType        db.TriggerType `json:"triggerType"`
	TriggerValue       string         `json:"triggerValue"`
	LastPerformedValue *string        `json:"lastPerformedValue"`
}

type UpdateAlertInput struct {
	Type               *db.AlertType   `json:"type"`
	Title              *string         `json:"title"`
	TriggerType        *db.TriggerType `json:"triggerType"`
	TriggerValue       *string         `json:"triggerValue"`
	LastPerformedValue *string         `json:"lastPerformedValue"`
	IsCompleted        *bool           `json:"isCompleted"`
}

// GetVehicleAlerts retrieves maintenance alerts for a specific vehicle
func GetVehicleAlerts(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	vehicleId := chi.URLParam(r, "vehicleId")
	var vehicle db.Vehicle
	if err := db.DB.First(&vehicle, "id = ?", vehicleId).Error; err != nil {
		http.Error(w, `{"error":"Vehicle not found"}`, http.StatusNotFound)
		return
	}

	if vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	var alerts []db.MaintenanceAlert
	err = db.DB.Where("\"vehicleId\" = ?", vehicleId).
		Order("\"isCompleted\" asc, \"createdAt\" desc").
		Find(&alerts).Error

	if err != nil {
		http.Error(w, `{"error":"Failed to fetch alerts"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(alerts)
}

// CreateAlert creates a new maintenance alert
func CreateAlert(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var input CreateAlertInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.VehicleID == "" || input.Title == "" || input.TriggerValue == "" {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	var vehicle db.Vehicle
	if err := db.DB.First(&vehicle, "id = ?", input.VehicleID).Error; err != nil {
		http.Error(w, `{"error":"Vehicle not found"}`, http.StatusNotFound)
		return
	}

	if vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	// Validate trigger values
	if input.TriggerType == db.TriggerMileage {
		if _, err := strconv.Atoi(input.TriggerValue); err != nil {
			http.Error(w, `{"error":"For MILEAGE triggers, triggerValue must be a valid number"}`, http.StatusBadRequest)
			return
		}
	} else if input.TriggerType == db.TriggerDate {
		_, err1 := time.Parse(time.RFC3339, input.TriggerValue)
		_, err2 := time.Parse("2006-01-02", input.TriggerValue)
		if err1 != nil && err2 != nil {
			http.Error(w, `{"error":"For DATE triggers, triggerValue must be a valid RFC3339 or YYYY-MM-DD date"}`, http.StatusBadRequest)
			return
		}
	}

	alert := db.MaintenanceAlert{
		VehicleID:          input.VehicleID,
		Type:               input.Type,
		Title:              input.Title,
		TriggerType:        input.TriggerType,
		TriggerValue:       input.TriggerValue,
		LastPerformedValue: input.LastPerformedValue,
		IsCompleted:        false,
	}

	if err := db.DB.Create(&alert).Error; err != nil {
		http.Error(w, `{"error":"Failed to create alert"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(alert)
}

// UpdateAlert updates an alert's parameters
func UpdateAlert(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	id := chi.URLParam(r, "id")
	var alert db.MaintenanceAlert
	if err := db.DB.Preload("Vehicle").First(&alert, "id = ?", id).Error; err != nil {
		http.Error(w, `{"error":"Alert not found"}`, http.StatusNotFound)
		return
	}

	if alert.Vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	var input UpdateAlertInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	err = db.DB.Transaction(func(tx *gorm.DB) error {
		var updateErr error
		alert, updateErr = updateMaintenanceAlert(tx, id, clerkId, input)
		return updateErr
	})
	if err != nil {
		http.Error(w, `{"error":"Failed to update alert"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(alert)
}

// DeleteAlert removes a maintenance alert
func DeleteAlert(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	id := chi.URLParam(r, "id")
	var alert db.MaintenanceAlert
	if err := db.DB.Preload("Vehicle").First(&alert, "id = ?", id).Error; err != nil {
		http.Error(w, `{"error":"Alert not found"}`, http.StatusNotFound)
		return
	}

	if alert.Vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	if err := db.DB.Delete(&alert).Error; err != nil {
		http.Error(w, `{"error":"Failed to delete alert"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true,"message":"Alert deleted"}`))
}

// TriggerCronCheckAlerts exposes an authenticated trigger for both alert types.
func TriggerCronCheckAlerts(w http.ResponseWriter, r *http.Request) {
	cronSecret := os.Getenv("CRON_SECRET")
	if cronSecret == "" {
		http.Error(w, `{"error":"Cron trigger is not configured"}`, http.StatusServiceUnavailable)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+cronSecret {
		http.Error(w, `{"error":"Unauthorized cron trigger"}`, http.StatusUnauthorized)
		return
	}
	if err := CheckPendingAlerts(); err != nil {
		log.Printf("Checking alerts failed: %v", err)
		http.Error(w, `{"error":"Failed to check alerts"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

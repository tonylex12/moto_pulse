package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"backend_go/db"
	"backend_go/middleware"
	"backend_go/push"
	"github.com/go-chi/chi/v5"
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

	updates := map[string]interface{}{}
	if input.Type != nil { updates["type"] = *input.Type }
	if input.Title != nil { updates["title"] = *input.Title }
	if input.TriggerType != nil { updates["triggerType"] = *input.TriggerType }
	if input.TriggerValue != nil { updates["triggerValue"] = *input.TriggerValue }
	if input.LastPerformedValue != nil { updates["lastPerformedValue"] = input.LastPerformedValue }
	if input.IsCompleted != nil { updates["isCompleted"] = *input.IsCompleted }

	if len(updates) > 0 {
		if err := db.DB.Model(&alert).Updates(updates).Error; err != nil {
			http.Error(w, `{"error":"Failed to update alert"}`, http.StatusInternalServerError)
			return
		}
	}

	// Reload updated alert
	db.DB.First(&alert, "id = ?", id)

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

// CheckAndTriggerAlerts scans and dispatches push notifications for mileage-based triggers
func CheckAndTriggerAlerts(vehicleId string, currentMileage int) {
	var pendingAlerts []db.MaintenanceAlert
	err := db.DB.Preload("Vehicle.User").
		Where("\"vehicleId\" = ? AND \"triggerType\" = ? AND \"isCompleted\" = ?", vehicleId, db.TriggerMileage, false).
		Find(&pendingAlerts).Error

	if err != nil {
		log.Printf("❌ Failed to query pending mileage alerts: %v", err)
		return
	}

	for _, alert := range pendingAlerts {
		targetMileage, err := strconv.Atoi(alert.TriggerValue)
		if err != nil {
			continue
		}

		if currentMileage >= targetMileage {
			log.Printf("🛠️ Mileage Alert Triggered: %s for %s %s. Value: %d/%d", alert.Title, alert.Vehicle.Brand, alert.Vehicle.Model, currentMileage, targetMileage)

			// Mark alert as completed to prevent duplicate notifications
			db.DB.Model(&alert).Update("\"isCompleted\"", true)

			// Send notification
			if alert.Vehicle.User.ExpoPushToken != nil && *alert.Vehicle.User.ExpoPushToken != "" {
				pushToken := *alert.Vehicle.User.ExpoPushToken
				title := fmt.Sprintf("Mantenimiento: %s 🛠️", alert.Title)
				body := fmt.Sprintf("Tu %s %s ha alcanzado los %d km. Se requiere cambiar/revisar: %s.", 
					alert.Vehicle.Brand, alert.Vehicle.Model, currentMileage, strings.ToLower(alert.Title))
				
				payload := map[string]interface{}{
					"alertId":   alert.ID,
					"vehicleId": vehicleId,
				}
				push.SendPushNotification(pushToken, title, body, payload)
			}
		}
	}
}

// CheckDateAlerts verifies calendar based triggers (insurance renewals, etc.)
func CheckDateAlerts() {
	log.Println("⏰ Running automatic date-based alerts check...")
	today := time.Now()
	warningWindow := today.AddDate(0, 0, 7) // 7 days in the future

	var pendingAlerts []db.MaintenanceAlert
	err := db.DB.Preload("Vehicle.User").
		Where("\"triggerType\" = ? AND \"isCompleted\" = ?", db.TriggerDate, false).
		Find(&pendingAlerts).Error

	if err != nil {
		log.Printf("❌ Failed to query pending date alerts: %v", err)
		return
	}

	for _, alert := range pendingAlerts {
		var targetDate time.Time
		var parseErr error

		targetDate, parseErr = time.Parse(time.RFC3339, alert.TriggerValue)
		if parseErr != nil {
			targetDate, parseErr = time.Parse("2006-01-02", alert.TriggerValue)
		}

		if parseErr != nil {
			continue
		}

		if targetDate.Before(warningWindow) || targetDate.Equal(warningWindow) {
			log.Printf("📋 Date Alert Triggered: %s (Deadline: %s)", alert.Title, alert.TriggerValue)

			// Send notification
			if alert.Vehicle.User.ExpoPushToken != nil && *alert.Vehicle.User.ExpoPushToken != "" {
				pushToken := *alert.Vehicle.User.ExpoPushToken
				daysLeft := int(math.Ceil(targetDate.Sub(today).Hours() / 24.0))
				bikeName := fmt.Sprintf("%s %s", alert.Vehicle.Brand, alert.Vehicle.Model)

				title := fmt.Sprintf("Vencimiento: %s 📋", alert.Title)
				var body string

				if daysLeft < 0 {
					body = fmt.Sprintf("¡ATENCIÓN! \"%s\" para tu %s venció hace %d días.", alert.Title, bikeName, int(math.Abs(float64(daysLeft))))
				} else if daysLeft == 0 {
					body = fmt.Sprintf("¡HOY vence \"%s\" de tu %s!", alert.Title, bikeName)
				} else {
					body = fmt.Sprintf("Quedan %d días para el vencimiento de \"%s\" en tu %s.", daysLeft, alert.Title, bikeName)
				}

				payload := map[string]interface{}{
					"alertId": alert.ID,
				}
				push.SendPushNotification(pushToken, title, body, payload)
			}

			// Mark completed after triggering once
			db.DB.Model(&alert).Update("\"isCompleted\"", true)
		}
	}
}

// TriggerCronCheckAlerts exposes an endpoint for manual/external cron trigger
func TriggerCronCheckAlerts(w http.ResponseWriter, r *http.Request) {
	cronSecret := os.Getenv("CRON_SECRET")
	authHeader := r.Header.Get("Authorization")

	if cronSecret != "" && authHeader != "Bearer "+cronSecret {
		http.Error(w, `{"error":"Unauthorized cron trigger"}`, http.StatusUnauthorized)
		return
	}

	log.Println("HTTP trigger for scheduled date-based alerts check received.")
	CheckDateAlerts()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true,"message":"Cron alerts checked successfully"}`))
}

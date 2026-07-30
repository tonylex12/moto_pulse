package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"backend_go/db"
	"backend_go/middleware"
	"github.com/go-chi/chi/v5"
)

type CreateFuelLogInput struct {
	VehicleID string    `json:"vehicleId"`
	Odometer  int       `json:"odometer"`
	Liters    float64   `json:"liters"`
	Price     float64   `json:"price"`
	Notes     *string   `json:"notes"`
	Date      *time.Time `json:"date"`
}

// GetVehicleFuelLogs retrieves fuel records for a specific vehicle
func GetVehicleFuelLogs(w http.ResponseWriter, r *http.Request) {
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

	var logs []db.FuelLog
	err = db.DB.Where("\"vehicleId\" = ?", vehicleId).Order("odometer desc").Find(&logs).Error
	if err != nil {
		http.Error(w, `{"error":"Failed to fetch fuel logs"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}

// CreateFuelLog registers a fuel log and checks odometer thresholds
func CreateFuelLog(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var input CreateFuelLogInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.VehicleID == "" || input.Odometer < 0 || input.Liters <= 0 || input.Price <= 0 {
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

	logDate := time.Now()
	if input.Date != nil {
		logDate = *input.Date
	}

	logEntry := db.FuelLog{
		VehicleID: input.VehicleID,
		Odometer:  input.Odometer,
		Liters:    input.Liters,
		Price:     input.Price,
		Notes:     input.Notes,
		Date:      logDate,
	}

	tx := db.DB.Begin()
	if err := tx.Create(&logEntry).Error; err != nil {
		tx.Rollback()
		http.Error(w, `{"error":"Failed to record fuel log"}`, http.StatusInternalServerError)
		return
	}

	updatedMileage := vehicle.CurrentMileage
	if input.Odometer > vehicle.CurrentMileage {
		if err := tx.Model(&vehicle).Update("currentMileage", input.Odometer).Error; err != nil {
			tx.Rollback()
			http.Error(w, `{"error":"Failed to update vehicle mileage"}`, http.StatusInternalServerError)
			return
		}
		updatedMileage = input.Odometer
	}
	tx.Commit()

	// If odometer was updated, trigger mileage-based alerts check in the background
	if updatedMileage > vehicle.CurrentMileage {
		go CheckAndTriggerAlerts(vehicle.ID, updatedMileage)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"log":            logEntry,
		"updatedMileage": updatedMileage,
	})
}

// DeleteFuelLog deletes a fuel log
func DeleteFuelLog(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	id := chi.URLParam(r, "id")
	var logEntry db.FuelLog
	if err := db.DB.Preload("Vehicle").First(&logEntry, "id = ?", id).Error; err != nil {
		http.Error(w, `{"error":"Fuel log not found"}`, http.StatusNotFound)
		return
	}

	if logEntry.Vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	if err := db.DB.Delete(&logEntry).Error; err != nil {
		http.Error(w, `{"error":"Failed to delete fuel log"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true,"message":"Fuel log deleted"}`))
}

// GetFuelStats calculates average fuel consumption and statistics
func GetFuelStats(w http.ResponseWriter, r *http.Request) {
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

	var logs []db.FuelLog
	err = db.DB.Where("\"vehicleId\" = ?", vehicleId).Order("odometer asc").Find(&logs).Error
	if err != nil {
		http.Error(w, `{"error":"Failed to fetch logs for stats"}`, http.StatusInternalServerError)
		return
	}

	if len(logs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"totalLogs":      0,
			"totalCost":      0,
			"totalLiters":    0,
			"totalDistance":  0,
			"avgConsumption": 0,
			"costPerKm":      0,
		})
		return
	}

	totalCost := 0.0
	totalLiters := 0.0
	for _, l := range logs {
		totalCost += l.Price
		totalLiters += l.Liters
	}

	totalDistance := 0
	avgConsumption := 0.0
	costPerKm := 0.0

	if len(logs) >= 2 {
		minOdo := logs[0].Odometer
		maxOdo := logs[len(logs)-1].Odometer
		totalDistance = maxOdo - minOdo

		// Total distance / liters of all logs EXCEPT the last fill
		litersExceptLast := 0.0
		for i := 0; i < len(logs)-1; i++ {
			litersExceptLast += logs[i].Liters
		}

		if totalDistance > 0 && litersExceptLast > 0 {
			avgConsumption = float64(totalDistance) / litersExceptLast
			costPerKm = totalCost / float64(totalDistance)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"totalLogs":      len(logs),
		"totalCost":      totalCost,
		"totalLiters":    totalLiters,
		"totalDistance":  totalDistance,
		"avgConsumption": float64(int(avgConsumption*100)) / 100.0, // Format to 2 decimal places
		"costPerKm":      float64(int(costPerKm*100)) / 100.0,
	})
}

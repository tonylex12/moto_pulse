package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"backend_go/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	jobVehicleLookup = "vehicle_lookup"
	jobAlertScan     = "alert_scan"
)

type vehicleLookupPayload struct {
	VehicleID string `json:"vehicleId"`
	Deep      bool   `json:"deep"`
}

func QueueVehicleLookup(vehicleID string, deep bool) error {
	payload, _ := json.Marshal(vehicleLookupPayload{VehicleID: vehicleID, Deep: deep})
	key := fmt.Sprintf("%s:%s:%t", jobVehicleLookup, vehicleID, deep)
	job := db.BackgroundJob{Type: jobVehicleLookup, Payload: payload, Status: "pending", DedupKey: key, MaxAttempts: 5, AvailableAt: time.Now()}
	return db.DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "dedupKey"}}, DoUpdates: clause.Assignments(map[string]interface{}{"status": "pending", "availableAt": time.Now(), "attempts": 0, "lastError": nil})}).Create(&job).Error
}

func QueueAlertScan() error {
	window := time.Now().UTC().Truncate(5 * time.Minute).Format(time.RFC3339)
	payload, _ := json.Marshal(map[string]string{"window": window})
	job := db.BackgroundJob{Type: jobAlertScan, Payload: payload, Status: "pending", DedupKey: jobAlertScan + ":" + window, MaxAttempts: 5, AvailableAt: time.Now()}
	return db.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&job).Error
}

func ProcessBackgroundJobs(limit int) error {
	var failures []error
	for i := 0; i < limit; i++ {
		job, err := claimJob(db.DB)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			break
		}
		if err != nil {
			return err
		}
		if err := executeJob(job); err != nil {
			failures = append(failures, err)
			retryJob(job, err)
		} else {
			db.DB.Model(job).Updates(map[string]interface{}{"status": "succeeded", "lockedAt": nil, "lastError": nil})
		}
	}
	return errors.Join(failures...)
}

func claimJob(database *gorm.DB) (*db.BackgroundJob, error) {
	var claimed db.BackgroundJob
	err := database.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where(`status = 'pending' AND "availableAt" <= ?`, time.Now()).Order(`"availableAt" asc`).First(&claimed).Error; err != nil {
			return err
		}
		now := time.Now()
		return tx.Model(&claimed).Updates(map[string]interface{}{"status": "running", "lockedAt": now, "attempts": gorm.Expr("attempts + 1")}).Error
	})
	return &claimed, err
}

func executeJob(job *db.BackgroundJob) error {
	switch job.Type {
	case jobAlertScan:
		return CheckPendingAlerts()
	case jobVehicleLookup:
		var payload vehicleLookupPayload
		if err := json.Unmarshal(job.Payload, &payload); err != nil {
			return err
		}
		var vehicle db.Vehicle
		if err := db.DB.First(&vehicle, "id = ?", payload.VehicleID).Error; err != nil {
			return err
		}
		if payload.Deep {
			RunDeepSpecsAndImageLookup(vehicle.ID, vehicle.Brand, vehicle.Model, vehicle.Year)
		} else {
			RunSpecsAndImageLookup(vehicle.ID, vehicle.Brand, vehicle.Model, vehicle.Year)
		}
		return nil
	default:
		return fmt.Errorf("unknown job type %q", job.Type)
	}
}

func retryJob(job *db.BackgroundJob, jobErr error) {
	message := jobErr.Error()
	status := "pending"
	if job.Attempts+1 >= job.MaxAttempts {
		status = "failed"
	}
	delay := time.Duration(1<<min(job.Attempts, 6)) * time.Minute
	if err := db.DB.Model(job).Updates(map[string]interface{}{"status": status, "lockedAt": nil, "lastError": message, "availableAt": time.Now().Add(delay)}).Error; err != nil {
		log.Printf("failed to persist job retry id=%s: %v", job.ID, err)
	}
}

package handlers

import (
	"errors"
	"fmt"
	"log"
	"strconv"
	"time"

	"backend_go/db"
	"backend_go/push"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type pushSender func(string, string, string, map[string]interface{}) error

// CheckPendingAlerts retries both types, using persisted mileage rather than an event snapshot.
func CheckPendingAlerts() error {
	return processPendingAlerts(db.DB, "", push.SendPushNotification, time.Now())
}

func checkVehicleAlerts(database *gorm.DB, vehicleID string) {
	if err := processPendingAlerts(database, vehicleID, push.SendPushNotification, time.Now()); err != nil {
		log.Printf("Checking vehicle alerts failed: %v", err)
	}
}

func processPendingAlerts(database *gorm.DB, vehicleID string, send pushSender, now time.Time) error {
	query := database.Model(&db.MaintenanceAlert{}).Where(`"isCompleted" = false AND "notifiedAt" IS NULL`)
	if vehicleID != "" {
		query = query.Where(`"vehicleId" = ?`, vehicleID)
	}
	var ids []string
	if err := query.Pluck("id", &ids).Error; err != nil {
		return err
	}
	var failures []error
	for _, id := range ids {
		if err := processAlert(database, id, send, now); err != nil {
			failures = append(failures, fmt.Errorf("alert %s: %w", id, err))
		}
	}
	return errors.Join(failures...)
}

func processAlert(database *gorm.DB, id string, send pushSender, now time.Time) error {
	return database.Transaction(func(tx *gorm.DB) error {
		var alert db.MaintenanceAlert
		err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Preload("Vehicle.User").First(&alert, "id = ?", id).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil // Deleted, or another worker owns this row.
		}
		if err != nil {
			return err
		}
		// Candidate scans can be stale: all conditions are checked again under the lock.
		if !alertDue(alert, now) || alert.Vehicle.User.ExpoPushToken == nil || *alert.Vehicle.User.ExpoPushToken == "" {
			return nil
		}
		title := "Mantenimiento: " + alert.Title
		body := fmt.Sprintf("Tu %s %s necesita revisión: %s (objetivo: %s).", alert.Vehicle.Brand, alert.Vehicle.Model, alert.Title, alert.TriggerValue)
		if err := send(*alert.Vehicle.User.ExpoPushToken, title, body, map[string]interface{}{"alertId": alert.ID, "vehicleId": alert.VehicleID}); err != nil {
			return err // Roll back; retry on the next scan.
		}
		// Acceptance by Expo is not maintenance completion or device delivery.
		// Expo and PostgreSQL are not atomic: a failed update/commit can cause a duplicate.
		return tx.Model(&alert).Update("notifiedAt", now).Error
	})
}

func alertDue(alert db.MaintenanceAlert, now time.Time) bool {
	if alert.IsCompleted || alert.NotifiedAt != nil {
		return false
	}
	switch alert.TriggerType {
	case db.TriggerMileage:
		target, err := strconv.Atoi(alert.TriggerValue)
		return err == nil && target >= 0 && alert.Vehicle.CurrentMileage >= target
	case db.TriggerDate:
		target, err := time.Parse(time.RFC3339, alert.TriggerValue)
		if err != nil {
			target, err = time.Parse("2006-01-02", alert.TriggerValue)
		}
		return err == nil && !target.After(now.AddDate(0, 0, 7))
	default:
		return false
	}
}

// The caller's transaction holds the same row lock as notification processing.
func updateMaintenanceAlert(tx *gorm.DB, id, userID string, input UpdateAlertInput) (db.MaintenanceAlert, error) {
	var alert db.MaintenanceAlert
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("Vehicle").First(&alert, "id = ?", id).Error; err != nil {
		return alert, err
	}
	if alert.Vehicle.UserID != userID {
		return alert, errors.New("alert does not belong to user")
	}
	updates := map[string]interface{}{}
	newCycle := false
	if input.Type != nil {
		updates["type"] = *input.Type
	}
	if input.Title != nil {
		updates["title"] = *input.Title
	}
	if input.TriggerType != nil {
		updates["triggerType"] = *input.TriggerType
		newCycle = newCycle || *input.TriggerType != alert.TriggerType
	}
	if input.TriggerValue != nil {
		updates["triggerValue"] = *input.TriggerValue
		newCycle = newCycle || *input.TriggerValue != alert.TriggerValue
	}
	if input.LastPerformedValue != nil {
		updates["lastPerformedValue"] = *input.LastPerformedValue
		newCycle = newCycle || alert.LastPerformedValue == nil || *input.LastPerformedValue != *alert.LastPerformedValue
	}
	if input.IsCompleted != nil {
		updates["isCompleted"] = *input.IsCompleted
		newCycle = newCycle || (alert.IsCompleted && !*input.IsCompleted)
	}
	if newCycle {
		updates["notifiedAt"] = nil
	}
	if len(updates) > 0 {
		if err := tx.Model(&alert).Updates(updates).Error; err != nil {
			return alert, err
		}
	}
	return alert, nil
}

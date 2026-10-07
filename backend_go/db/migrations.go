package db

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

type schemaMigration struct {
	Version   string    `gorm:"primaryKey;column:version"`
	AppliedAt time.Time `gorm:"column:appliedAt;not null"`
}

func (schemaMigration) TableName() string { return "SchemaMigration" }

var migrations = []struct {
	version    string
	statements []string
}{
	{"2026100601_reliability_indexes", []string{
		`WITH ranked AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "updatedAt" DESC, "createdAt" DESC) AS rn FROM "Vehicle" WHERE "isActive" = true) UPDATE "Vehicle" SET "isActive" = false FROM ranked WHERE "Vehicle".id = ranked.id AND ranked.rn > 1`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_one_active_per_user ON "Vehicle" ("userId") WHERE "isActive" = true`,
		`CREATE INDEX IF NOT EXISTS idx_fuel_log_vehicle_date ON "FuelLog" ("vehicleId", date DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_alert_pending ON "MaintenanceAlert" ("vehicleId", "triggerType") WHERE "isCompleted" = false AND "notifiedAt" IS NULL`,
		`CREATE INDEX IF NOT EXISTS idx_route_user_created ON "SavedRoute" ("userId", "createdAt" DESC)`,
	}},
}

func runMigrations(database *gorm.DB) error {
	if err := database.AutoMigrate(&schemaMigration{}); err != nil {
		return err
	}
	for _, migration := range migrations {
		var count int64
		if err := database.Model(&schemaMigration{}).Where("version = ?", migration.version).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		if err := database.Transaction(func(tx *gorm.DB) error {
			for _, statement := range migration.statements {
				if err := tx.Exec(statement).Error; err != nil {
					return err
				}
			}
			return tx.Create(&schemaMigration{Version: migration.version, AppliedAt: time.Now()}).Error
		}); err != nil {
			return fmt.Errorf("migration %s failed: %w", migration.version, err)
		}
	}
	return nil
}

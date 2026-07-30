package db

import (
	"fmt"
	"log"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// InitDB initializes the PostgreSQL connection using GORM and auto-migrates the schema
func InitDB(databaseURL string) (*gorm.DB, error) {
	log.Printf("Connecting to database...")
	
	db, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	log.Printf("Database connection established. Running auto-migrations...")
	
	// GORM AutoMigrate is safe and handles missing tables, columns, and indexes.
	// It respects the custom table names defined in TableName() on each struct.
	err = db.AutoMigrate(
		&User{},
		&Vehicle{},
		&FuelLog{},
		&MaintenanceAlert{},
		&SavedRoute{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	DB = db
	log.Println("Database initialization completed successfully.")
	return db, nil
}

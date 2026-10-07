package db

import (
	"crypto/rand"
	"database/sql/driver"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// GenerateUUID generates a random UUID v4 string using crypto/rand
func GenerateUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40 // Version 4
	b[8] = (b[8] & 0x3f) | 0x80 // Variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// JSON helper type for handling JSONB coordinates in PostgreSQL
type JSON []byte

func (j JSON) Value() (driver.Value, error) {
	if len(j) == 0 {
		return nil, nil
	}
	return string(j), nil
}

func (j *JSON) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	switch v := value.(type) {
	case []byte:
		*j = append([]byte{}, v...)
	case string:
		*j = []byte(v)
	default:
		return errors.New("invalid scan source for JSON")
	}
	return nil
}

func (j JSON) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("null"), nil
	}
	return j, nil
}

func (j *JSON) UnmarshalJSON(data []byte) error {
	if j == nil {
		return errors.New("json.RawMessage: UnmarshalJSON on nil pointer")
	}
	*j = append((*j)[0:0], data...)
	return nil
}

// User model mapping to the "User" table
type User struct {
	ClerkID       string    `gorm:"primaryKey;column:clerkId;not null" json:"clerkId"`
	Email         string    `gorm:"column:email;not null" json:"email"`
	ExpoPushToken *string   `gorm:"column:expoPushToken" json:"expoPushToken"`
	CreatedAt     time.Time `gorm:"column:createdAt;default:now();not null" json:"createdAt"`
	UpdatedAt     time.Time `gorm:"column:updatedAt;not null" json:"updatedAt"`
	Vehicles      []Vehicle `gorm:"foreignKey:UserID;references:ClerkID;constraint:OnDelete:CASCADE" json:"vehicles,omitempty"`
}

func (User) TableName() string {
	return "User"
}

// Vehicle model mapping to the "Vehicle" table
type Vehicle struct {
	ID              string             `gorm:"primaryKey;column:id;not null" json:"id"`
	Brand           string             `gorm:"column:brand;not null" json:"brand"`
	Model           string             `gorm:"column:model;not null" json:"model"`
	Year            int                `gorm:"column:year;not null" json:"year"`
	CurrentMileage  int                `gorm:"column:currentMileage;not null" json:"currentMileage"`
	UserID          string             `gorm:"column:userId;not null" json:"userId"`
	User            User               `gorm:"foreignKey:UserID;references:ClerkID" json:"user,omitempty"`
	FuelLogs        []FuelLog          `gorm:"foreignKey:VehicleID;references:ID;constraint:OnDelete:CASCADE" json:"fuelLogs,omitempty"`
	Alerts          []MaintenanceAlert `gorm:"foreignKey:VehicleID;references:ID;constraint:OnDelete:CASCADE" json:"alerts,omitempty"`
	IsActive        bool               `gorm:"column:isActive;default:false;not null" json:"isActive"`
	TankSize        *string            `gorm:"column:tankSize" json:"tankSize"`
	FrontBrake      *string            `gorm:"column:frontBrake" json:"frontBrake"`
	RearBrake       *string            `gorm:"column:rearBrake" json:"rearBrake"`
	FrontSuspension *string            `gorm:"column:frontSuspension" json:"frontSuspension"`
	RearSuspension  *string            `gorm:"column:rearSuspension" json:"rearSuspension"`
	FrontTire       *string            `gorm:"column:frontTire" json:"frontTire"`
	RearTire        *string            `gorm:"column:rearTire" json:"rearTire"`
	EngineCc        *string            `gorm:"column:engineCc" json:"engineCc"`
	Power           *string            `gorm:"column:power" json:"power"`
	Torque          *string            `gorm:"column:torque" json:"torque"`
	Transmission    *string            `gorm:"column:transmission" json:"transmission"`
	Weight          *string            `gorm:"column:weight" json:"weight"`
	SeatHeight      *string            `gorm:"column:seatHeight" json:"seatHeight"`
	SpecSource      *string            `gorm:"column:specSource" json:"specSource"`
	ImageUrl        *string            `gorm:"column:imageUrl" json:"imageUrl"`
	CreatedAt       time.Time          `gorm:"column:createdAt;default:now();not null" json:"createdAt"`
	UpdatedAt       time.Time          `gorm:"column:updatedAt;not null" json:"updatedAt"`
}

func (Vehicle) TableName() string {
	return "Vehicle"
}

func (v *Vehicle) BeforeCreate(tx *gorm.DB) (err error) {
	if v.ID == "" {
		v.ID = GenerateUUID()
	}
	return
}

// FuelLog model mapping to the "FuelLog" table
type FuelLog struct {
	ID        string    `gorm:"primaryKey;column:id;not null" json:"id"`
	Odometer  int       `gorm:"column:odometer;not null" json:"odometer"`
	Liters    float64   `gorm:"column:liters;not null" json:"liters"`
	Price     float64   `gorm:"column:price;not null" json:"price"`
	Notes     *string   `gorm:"column:notes" json:"notes"`
	Date      time.Time `gorm:"column:date;default:now();not null" json:"date"`
	VehicleID string    `gorm:"column:vehicleId;not null" json:"vehicleId"`
	Vehicle   Vehicle   `gorm:"foreignKey:VehicleID;references:ID" json:"vehicle,omitempty"`
	CreatedAt time.Time `gorm:"column:createdAt;default:now();not null" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updatedAt;not null" json:"updatedAt"`
}

func (FuelLog) TableName() string {
	return "FuelLog"
}

func (f *FuelLog) BeforeCreate(tx *gorm.DB) (err error) {
	if f.ID == "" {
		f.ID = GenerateUUID()
	}
	return
}

type AlertType string

const (
	OilChange             AlertType = "OIL_CHANGE"
	BrakePads             AlertType = "BRAKE_PADS"
	InsuranceRenewal      AlertType = "INSURANCE_RENEWAL"
	PreventiveMaintenance AlertType = "PREVENTIVE_MAINTENANCE"
	CustomAlert           AlertType = "CUSTOM"
)

type TriggerType string

const (
	TriggerMileage TriggerType = "MILEAGE"
	TriggerDate    TriggerType = "DATE"
)

// MaintenanceAlert model mapping to the "MaintenanceAlert" table
type MaintenanceAlert struct {
	ID                 string      `gorm:"primaryKey;column:id;not null" json:"id"`
	Type               AlertType   `gorm:"column:type;not null" json:"type"`
	Title              string      `gorm:"column:title;not null" json:"title"`
	TriggerType        TriggerType `gorm:"column:triggerType;not null" json:"triggerType"`
	TriggerValue       string      `gorm:"column:triggerValue;not null" json:"triggerValue"`
	LastPerformedValue *string     `gorm:"column:lastPerformedValue" json:"lastPerformedValue"`
	IsCompleted        bool        `gorm:"column:isCompleted;default:false;not null" json:"isCompleted"`
	NotifiedAt         *time.Time  `gorm:"column:notifiedAt" json:"notifiedAt"`
	VehicleID          string      `gorm:"column:vehicleId;not null" json:"vehicleId"`
	Vehicle            Vehicle     `gorm:"foreignKey:VehicleID;references:ID" json:"vehicle,omitempty"`
	CreatedAt          time.Time   `gorm:"column:createdAt;default:now();not null" json:"createdAt"`
	UpdatedAt          time.Time   `gorm:"column:updatedAt;not null" json:"updatedAt"`
}

func (MaintenanceAlert) TableName() string {
	return "MaintenanceAlert"
}

func (a *MaintenanceAlert) BeforeCreate(tx *gorm.DB) (err error) {
	if a.ID == "" {
		a.ID = GenerateUUID()
	}
	return
}

// SavedRoute model mapping to the "SavedRoute" table
type SavedRoute struct {
	ID           string    `gorm:"primaryKey;column:id;not null" json:"id"`
	Name         string    `gorm:"column:name;not null" json:"name"`
	Coordinates  JSON      `gorm:"column:coordinates;type:jsonb;not null" json:"coordinates"`
	StartPoint   *string   `gorm:"column:startPoint" json:"startPoint"`
	EndPoint     *string   `gorm:"column:endPoint" json:"endPoint"`
	Distance     *float64  `gorm:"column:distance" json:"distance"`
	Notes        *string   `gorm:"column:notes" json:"notes"`
	MaxSpeed     *float64  `gorm:"column:maxSpeed" json:"maxSpeed"`
	MaxLeftLean  *float64  `gorm:"column:maxLeftLean" json:"maxLeftLean"`
	MaxRightLean *float64  `gorm:"column:maxRightLean" json:"maxRightLean"`
	UserID       string    `gorm:"column:userId;not null" json:"userId"`
	CreatedAt    time.Time `gorm:"column:createdAt;default:now();not null" json:"createdAt"`
	UpdatedAt    time.Time `gorm:"column:updatedAt;not null" json:"updatedAt"`
}

// BackgroundJob is a durable PostgreSQL-backed work item. A unique DedupKey
// makes enqueueing idempotent while a job is pending or running.
type BackgroundJob struct {
	ID          string     `gorm:"primaryKey;column:id;not null" json:"id"`
	Type        string     `gorm:"column:type;not null;index:idx_jobs_claim,priority:2" json:"type"`
	Payload     JSON       `gorm:"column:payload;type:jsonb;not null" json:"payload"`
	Status      string     `gorm:"column:status;not null;default:pending;index:idx_jobs_claim,priority:1" json:"status"`
	DedupKey    string     `gorm:"column:dedupKey;not null;uniqueIndex" json:"dedupKey"`
	Attempts    int        `gorm:"column:attempts;not null;default:0" json:"attempts"`
	MaxAttempts int        `gorm:"column:maxAttempts;not null;default:5" json:"maxAttempts"`
	AvailableAt time.Time  `gorm:"column:availableAt;not null;index:idx_jobs_claim,priority:3" json:"availableAt"`
	LockedAt    *time.Time `gorm:"column:lockedAt" json:"lockedAt"`
	LastError   *string    `gorm:"column:lastError" json:"lastError"`
	CreatedAt   time.Time  `gorm:"column:createdAt;default:now();not null" json:"createdAt"`
	UpdatedAt   time.Time  `gorm:"column:updatedAt;not null" json:"updatedAt"`
}

func (BackgroundJob) TableName() string { return "BackgroundJob" }

func (j *BackgroundJob) BeforeCreate(tx *gorm.DB) error {
	if j.ID == "" {
		j.ID = GenerateUUID()
	}
	return nil
}

func (SavedRoute) TableName() string {
	return "SavedRoute"
}

func (s *SavedRoute) BeforeCreate(tx *gorm.DB) (err error) {
	if s.ID == "" {
		s.ID = GenerateUUID()
	}
	return
}

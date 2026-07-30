package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"backend_go/db"
	"backend_go/middleware"
	"backend_go/scraper"
	"github.com/go-chi/chi/v5"
)

type CreateVehicleInput struct {
	Brand          string `json:"brand"`
	Model          string `json:"model"`
	Year           int    `json:"year"`
	CurrentMileage int    `json:"currentMileage"`
}

type UpdateVehicleInput struct {
	Brand           *string `json:"brand"`
	Model           *string `json:"model"`
	Year            *int    `json:"year"`
	CurrentMileage  *int    `json:"currentMileage"`
	TankSize        *string `json:"tankSize"`
	FrontBrake      *string `json:"frontBrake"`
	RearBrake       *string `json:"rearBrake"`
	FrontSuspension *string `json:"frontSuspension"`
	RearSuspension  *string `json:"rearSuspension"`
	FrontTire       *string `json:"frontTire"`
	RearTire        *string `json:"rearTire"`
	EngineCc        *string `json:"engineCc"`
	Power           *string `json:"power"`
	Torque          *string `json:"torque"`
	Transmission    *string `json:"transmission"`
	Weight          *string `json:"weight"`
	SeatHeight      *string `json:"seatHeight"`
}

// Background specs and image search using a Goroutine
func RunSpecsAndImageLookup(vehicleID string, brand, model string, year int) {
	log.Printf("🤖 Starting background lookup for Vehicle ID %s (%s %s %d)...", vehicleID, brand, model, year)
	
	// Fetch technical specs
	specs, err := scraper.FetchVehicleSpecs(brand, model, year)
	if err != nil {
		log.Printf("⚠️ Background specs lookup failed for vehicle %s: %v", vehicleID, err)
	}

	// Fetch image
	imgUrl, err := scraper.FetchVehicleImage(brand, model, year)
	if err != nil {
		log.Printf("⚠️ Background image lookup failed for vehicle %s: %v", vehicleID, err)
	}

	// Update vehicle record with scraped specs and image
	updates := map[string]interface{}{}
	if err == nil && imgUrl != "" {
		updates["imageUrl"] = imgUrl
	}

	if specs != nil {
		if specs.TankSize != nil { updates["tankSize"] = *specs.TankSize }
		if specs.FrontBrake != nil { updates["frontBrake"] = *specs.FrontBrake }
		if specs.RearBrake != nil { updates["rearBrake"] = *specs.RearBrake }
		if specs.FrontSuspension != nil { updates["frontSuspension"] = *specs.FrontSuspension }
		if specs.RearSuspension != nil { updates["rearSuspension"] = *specs.RearSuspension }
		if specs.FrontTire != nil { updates["frontTire"] = *specs.FrontTire }
		if specs.RearTire != nil { updates["rearTire"] = *specs.RearTire }
		if specs.EngineCc != nil { updates["engineCc"] = *specs.EngineCc }
		if specs.Power != nil { updates["power"] = *specs.Power }
		if specs.Torque != nil { updates["torque"] = *specs.Torque }
		if specs.Transmission != nil { updates["transmission"] = *specs.Transmission }
		if specs.Weight != nil { updates["weight"] = *specs.Weight }
		if specs.SeatHeight != nil { updates["seatHeight"] = *specs.SeatHeight }
		updates["specSource"] = "Scraped Heuristics"
	}

	if len(updates) > 0 {
		err := db.DB.Model(&db.Vehicle{}).Where("id = ?", vehicleID).Updates(updates).Error
		if err != nil {
			log.Printf("❌ Failed to update vehicle %s in background: %v", vehicleID, err)
		} else {
			log.Printf("✅ Background lookup completed and updated vehicle ID %s.", vehicleID)
		}
	}
}

// GetVehicles lists all vehicles owned by the authenticated user
func GetVehicles(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var vehicles []db.Vehicle
	err = db.DB.Where("\"userId\" = ?", clerkId).Order("\"createdAt\" desc").Find(&vehicles).Error
	if err != nil {
		http.Error(w, `{"error":"Failed to fetch vehicles"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(vehicles)
}

// GetVehicle retrieves details of a specific vehicle by ID
func GetVehicle(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	id := chi.URLParam(r, "id")
	var vehicle db.Vehicle
	if err := db.DB.First(&vehicle, "id = ?", id).Error; err != nil {
		http.Error(w, `{"error":"Vehicle not found"}`, http.StatusNotFound)
		return
	}

	if vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(vehicle)
}

// CreateVehicle handles vehicle registration and performs synchronous spec and image lookups (with a 4s timeout fallback, continuing in background if exceeded) before responding
func CreateVehicle(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var input CreateVehicleInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.Brand == "" || input.Model == "" || input.Year <= 0 {
		http.Error(w, `{"error":"Invalid inputs"}`, http.StatusBadRequest)
		return
	}

	// Clean all whitespaces from the model name to prevent mismatch issues (e.g. NX 190 -> NX190)
	cleanedModel := strings.ReplaceAll(input.Model, " ", "")

	// 1. Fetch specs and image in parallel, with a maximum 4-second timeout for the HTTP response
	var specs *scraper.VehicleSpecs
	var imgUrl string

	specsChan := make(chan *scraper.VehicleSpecs, 1)
	imgChan := make(chan string, 1)

	go func() {
		res, err := scraper.FetchVehicleSpecs(input.Brand, cleanedModel, input.Year)
		if err != nil {
			log.Printf("⚠️ Specs lookup failed for %s %s (%d): %v", input.Brand, cleanedModel, input.Year, err)
		}
		specsChan <- res
	}()

	go func() {
		res, err := scraper.FetchVehicleImage(input.Brand, cleanedModel, input.Year)
		if err != nil {
			log.Printf("⚠️ Image lookup failed for %s %s (%d): %v", input.Brand, cleanedModel, input.Year, err)
		}
		imgChan <- res
	}()

	// Wait loop with a 4-second timeout limit
	timeout := time.After(4 * time.Second)
	specsDone := false
	imgDone := false

	for !specsDone || !imgDone {
		select {
		case s := <-specsChan:
			specs = s
			specsDone = true
		case img := <-imgChan:
			imgUrl = img
			imgDone = true
		case <-timeout:
			log.Printf("⏰ Scraper lookups timed out after 4s for %s %s (%d). Proceeding immediately and continuing in background...", input.Brand, cleanedModel, input.Year)
			specsDone = true
			imgDone = true
		}
	}

	// 2. Start a DB transaction to deactivate previous vehicles and create the new one
	tx := db.DB.Begin()
	if tx.Error != nil {
		http.Error(w, `{"error":"Failed to start transaction"}`, http.StatusInternalServerError)
		return
	}

	// Deactivate all user's existing vehicles
	if err := tx.Model(&db.Vehicle{}).Where("\"userId\" = ?", clerkId).Update("\"isActive\"", false).Error; err != nil {
		tx.Rollback()
		http.Error(w, `{"error":"Failed to deactivate existing vehicles"}`, http.StatusInternalServerError)
		return
	}

	// Build the vehicle object with specs (if they completed within 4 seconds)
	vehicle := db.Vehicle{
		Brand:          input.Brand,
		Model:          cleanedModel,
		Year:           input.Year,
		CurrentMileage: input.CurrentMileage,
		UserID:         clerkId,
		IsActive:       true, // The new vehicle becomes active
	}

	if specs != nil {
		vehicle.TankSize = specs.TankSize
		vehicle.FrontBrake = specs.FrontBrake
		vehicle.RearBrake = specs.RearBrake
		vehicle.FrontSuspension = specs.FrontSuspension
		vehicle.RearSuspension = specs.RearSuspension
		vehicle.FrontTire = specs.FrontTire
		vehicle.RearTire = specs.RearTire
		vehicle.EngineCc = specs.EngineCc
		vehicle.Power = specs.Power
		vehicle.Torque = specs.Torque
		vehicle.Transmission = specs.Transmission
		vehicle.Weight = specs.Weight
		vehicle.SeatHeight = specs.SeatHeight
		specSource := "Búsqueda Web"
		vehicle.SpecSource = &specSource
	}

	if imgUrl != "" {
		vehicle.ImageUrl = &imgUrl
	}

	// 3. Create the vehicle (GORM will generate UUID if empty using BeforeCreate hook)
	if err := tx.Create(&vehicle).Error; err != nil {
		tx.Rollback()
		http.Error(w, `{"error":"Failed to create vehicle"}`, http.StatusInternalServerError)
		return
	}

	if err := tx.Commit().Error; err != nil {
		http.Error(w, `{"error":"Failed to commit transaction"}`, http.StatusInternalServerError)
		return
	}

	// 4. If we timed out (i.e. did not get both specs and image in 4 seconds), 
	// start a background goroutine to wait for the remaining channel results and update the DB!
	if specs == nil || imgUrl == "" {
		go func(vehicleID string) {
			var finalSpecs *scraper.VehicleSpecs = specs
			var finalImg string = imgUrl

			// Wait for specs if not done
			if finalSpecs == nil {
				select {
				case s := <-specsChan:
					finalSpecs = s
				case <-time.After(15 * time.Second): // absolute safety fallback limit
					log.Printf("⚠️ Background specs lookup aborted after 15s timeout for vehicle %s", vehicleID)
				}
			}
			// Wait for image if not done
			if finalImg == "" {
				select {
				case img := <-imgChan:
					finalImg = img
				case <-time.After(15 * time.Second): // absolute safety fallback limit
					log.Printf("⚠️ Background image lookup aborted after 15s timeout for vehicle %s", vehicleID)
				}
			}

			// Update the database if we got anything in background
			updates := map[string]interface{}{}
			if finalImg != "" {
				updates["imageUrl"] = finalImg
			}
			if finalSpecs != nil {
				if finalSpecs.TankSize != nil { updates["tankSize"] = *finalSpecs.TankSize }
				if finalSpecs.FrontBrake != nil { updates["frontBrake"] = *finalSpecs.FrontBrake }
				if finalSpecs.RearBrake != nil { updates["rearBrake"] = *finalSpecs.RearBrake }
				if finalSpecs.FrontSuspension != nil { updates["frontSuspension"] = *finalSpecs.FrontSuspension }
				if finalSpecs.RearSuspension != nil { updates["rearSuspension"] = *finalSpecs.RearSuspension }
				if finalSpecs.FrontTire != nil { updates["frontTire"] = *finalSpecs.FrontTire }
				if finalSpecs.RearTire != nil { updates["rearTire"] = *finalSpecs.RearTire }
				if finalSpecs.EngineCc != nil { updates["engineCc"] = *finalSpecs.EngineCc }
				if finalSpecs.Power != nil { updates["power"] = *finalSpecs.Power }
				if finalSpecs.Torque != nil { updates["torque"] = *finalSpecs.Torque }
				if finalSpecs.Transmission != nil { updates["transmission"] = *finalSpecs.Transmission }
				if finalSpecs.Weight != nil { updates["weight"] = *finalSpecs.Weight }
				if finalSpecs.SeatHeight != nil { updates["seatHeight"] = *finalSpecs.SeatHeight }
				updates["specSource"] = "Búsqueda Web"
			}

			if len(updates) > 0 {
				err := db.DB.Model(&db.Vehicle{}).Where("id = ?", vehicleID).Updates(updates).Error
				if err != nil {
					log.Printf("❌ Failed to update vehicle %s in background: %v", vehicleID, err)
				} else {
					log.Printf("✅ Background specs/image lookup completed and updated vehicle %s.", vehicleID)
				}
			}
		}(vehicle.ID)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(vehicle)
}

// UpdateVehicle updates basic information or specs of a vehicle
func UpdateVehicle(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	id := chi.URLParam(r, "id")
	var vehicle db.Vehicle
	if err := db.DB.First(&vehicle, "id = ?", id).Error; err != nil {
		http.Error(w, `{"error":"Vehicle not found"}`, http.StatusNotFound)
		return
	}

	if vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	var input UpdateVehicleInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	updates := map[string]interface{}{}
	if input.Brand != nil { updates["brand"] = *input.Brand }
	if input.Model != nil {
		// Clean spaces from model
		cleaned := strings.ReplaceAll(*input.Model, " ", "")
		updates["model"] = cleaned
	}
	if input.Year != nil { updates["year"] = *input.Year }
	if input.CurrentMileage != nil { updates["currentMileage"] = *input.CurrentMileage }
	if input.TankSize != nil { updates["tankSize"] = input.TankSize }
	if input.FrontBrake != nil { updates["frontBrake"] = input.FrontBrake }
	if input.RearBrake != nil { updates["rearBrake"] = input.RearBrake }
	if input.FrontSuspension != nil { updates["frontSuspension"] = input.FrontSuspension }
	if input.RearSuspension != nil { updates["rearSuspension"] = input.RearSuspension }
	if input.FrontTire != nil { updates["frontTire"] = input.FrontTire }
	if input.RearTire != nil { updates["rearTire"] = input.RearTire }
	if input.EngineCc != nil { updates["engineCc"] = input.EngineCc }
	if input.Power != nil { updates["power"] = input.Power }
	if input.Torque != nil { updates["torque"] = input.Torque }
	if input.Transmission != nil { updates["transmission"] = input.Transmission }
	if input.Weight != nil { updates["weight"] = input.Weight }
	if input.SeatHeight != nil { updates["seatHeight"] = input.SeatHeight }

	if len(updates) > 0 {
		if err := db.DB.Model(&vehicle).Updates(updates).Error; err != nil {
			http.Error(w, `{"error":"Failed to update vehicle"}`, http.StatusInternalServerError)
			return
		}
	}

	// Reload updated vehicle
	db.DB.First(&vehicle, "id = ?", id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(vehicle)
}

// DeleteVehicle removes a vehicle
func DeleteVehicle(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	id := chi.URLParam(r, "id")
	var vehicle db.Vehicle
	if err := db.DB.First(&vehicle, "id = ?", id).Error; err != nil {
		http.Error(w, `{"error":"Vehicle not found"}`, http.StatusNotFound)
		return
	}

	if vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	// GORM will cascade delete relations if foreign key constraints are defined with Cascade in DB,
	// which GORM AutoMigrate sets up due to constraint tags.
	if err := db.DB.Delete(&vehicle).Error; err != nil {
		http.Error(w, `{"error":"Failed to delete vehicle"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true,"message":"Vehicle deleted"}`))
}

// ToggleActiveVehicle sets the specified vehicle as active and deactivates all other user's vehicles
func ToggleActiveVehicle(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	id := chi.URLParam(r, "id")
	var vehicle db.Vehicle
	if err := db.DB.First(&vehicle, "id = ?", id).Error; err != nil {
		http.Error(w, `{"error":"Vehicle not found"}`, http.StatusNotFound)
		return
	}

	if vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	tx := db.DB.Begin()
	// Deactivate all user's vehicles
	if err := tx.Model(&db.Vehicle{}).Where("\"userId\" = ?", clerkId).Update("\"isActive\"", false).Error; err != nil {
		tx.Rollback()
		http.Error(w, `{"error":"Failed to toggle active state"}`, http.StatusInternalServerError)
		return
	}

	// Set target vehicle active
	if err := tx.Model(&vehicle).Update("\"isActive\"", true).Error; err != nil {
		tx.Rollback()
		http.Error(w, `{"error":"Failed to toggle active state"}`, http.StatusInternalServerError)
		return
	}
	tx.Commit()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// TriggerLookup manually queues background scraper searching
func TriggerLookup(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	id := chi.URLParam(r, "id")
	var vehicle db.Vehicle
	if err := db.DB.First(&vehicle, "id = ?", id).Error; err != nil {
		http.Error(w, `{"error":"Vehicle not found"}`, http.StatusNotFound)
		return
	}

	if vehicle.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	// Trigger lookup in background goroutine
	go RunSpecsAndImageLookup(vehicle.ID, vehicle.Brand, vehicle.Model, vehicle.Year)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true,"message":"Lookup triggered in background"}`))
}

package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"backend_go/db"
	"backend_go/handlers"
	"backend_go/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables from .env if present
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️ Warning: No .env file found, reading variables from system environment.")
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("❌ DATABASE_URL must be set in environment variables.")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	// Initialize Database connection and run migrations
	_, err := db.InitDB(databaseURL)
	if err != nil {
		log.Fatalf("❌ Database connection failed: %v", err)
	}

	// Configure chi router
	r := chi.NewRouter()

	// CORS config (allows local Expo CLI / mobile devices connectivity)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	// Health check endpoint
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"OK","timestamp":"%s"}`, time.Now().Format(time.RFC3339))
	})

	// Public cron triggers (triggered externally e.g. from server cron services)
	r.Post("/api/cron/check-alerts", handlers.TriggerCronCheckAlerts)

	// Clerk Auth authenticated route group
	r.Group(func(sub chi.Router) {
		sub.Use(middleware.RequireClerkAuth)

		// User endpoints
		sub.Post("/api/users/sync", handlers.SyncUser)
		sub.Post("/api/users/push-token", handlers.UpdatePushToken)

		// Vehicle endpoints
		sub.Get("/api/vehicles", handlers.GetVehicles)
		sub.Get("/api/vehicles/{id}", handlers.GetVehicle)
		sub.Post("/api/vehicles", handlers.CreateVehicle)
		sub.Put("/api/vehicles/{id}", handlers.UpdateVehicle)
		sub.Delete("/api/vehicles/{id}", handlers.DeleteVehicle)
		sub.Put("/api/vehicles/{id}/active", handlers.ToggleActiveVehicle)
		sub.Post("/api/vehicles/{id}/trigger-lookup", handlers.TriggerLookup)

		// Fuel Log endpoints
		sub.Get("/api/fuel-logs/vehicle/{vehicleId}", handlers.GetVehicleFuelLogs)
		sub.Post("/api/fuel-logs", handlers.CreateFuelLog)
		sub.Delete("/api/fuel-logs/{id}", handlers.DeleteFuelLog)
		sub.Get("/api/fuel-logs/stats/{vehicleId}", handlers.GetFuelStats)

		// Alert endpoints
		sub.Get("/api/alerts/vehicle/{vehicleId}", handlers.GetVehicleAlerts)
		sub.Post("/api/alerts", handlers.CreateAlert)
		sub.Put("/api/alerts/{id}", handlers.UpdateAlert)
		sub.Delete("/api/alerts/{id}", handlers.DeleteAlert)

		// Route endpoints
		sub.Get("/api/routes", handlers.GetRoutes)
		sub.Post("/api/routes", handlers.CreateRoute)
		sub.Delete("/api/routes/{id}", handlers.DeleteRoute)
	})

	// Internal Cron: scheduler running inside Go process checking date alerts every 12 hours
	go func() {
		ticker := time.NewTicker(12 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			handlers.CheckDateAlerts()
		}
	}()

	// Run initial date alerts check 5 seconds after boot
	go func() {
		time.Sleep(5 * time.Second)
		handlers.CheckDateAlerts()
	}()

	// Start HTTP server
	log.Printf("🏍️ MotoPulse Go backend server running on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("❌ Failed to start server: %v", err)
	}
}

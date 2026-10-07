package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
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

	clerkAuth, err := middleware.NewClerkAuth()
	if err != nil {
		log.Fatalf("Invalid Clerk authentication configuration: %v", err)
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
	_, err = db.InitDB(databaseURL)
	if err != nil {
		log.Fatalf("❌ Database connection failed: %v", err)
	}

	// Configure chi router
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(middleware.AccessLog)
	r.Use(middleware.LimitBody(2 << 20))

	// CORS config (allows local Expo CLI / mobile devices connectivity)
	allowedOrigins := []string{"http://localhost:*", "http://127.0.0.1:*"}
	if configured := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS")); configured != "" {
		allowedOrigins = strings.Split(configured, ",")
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
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
	r.Get("/ready", func(w http.ResponseWriter, r *http.Request) {
		sqlDB, err := db.DB.DB()
		if err != nil || sqlDB.PingContext(r.Context()) != nil {
			http.Error(w, `{"status":"unavailable"}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	})

	// Public cron triggers (triggered externally e.g. from server cron services)
	r.Post("/api/cron/check-alerts", handlers.TriggerCronCheckAlerts)

	// Clerk Auth authenticated route group
	r.Group(func(sub chi.Router) {
		sub.Use(clerkAuth)

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
		sub.Post("/api/vehicles/{id}/scrape", handlers.ScrapeVehicleSpecs)

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

	// Enqueue periodic work. Durable jobs are claimed with SKIP LOCKED, so this
	// remains safe when multiple API replicas are running.
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			if err := handlers.QueueAlertScan(); err != nil {
				log.Printf("queue alert scan failed: %v", err)
			}
		}
	}()
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if err := handlers.ProcessBackgroundJobs(5); err != nil {
				log.Printf("background jobs failed: %v", err)
			}
		}
	}()
	_ = handlers.QueueAlertScan()

	server := &http.Server{Addr: ":" + port, Handler: r, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("🏍️ MotoPulse Go backend server running on http://localhost:%s", port)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("❌ Failed to start server: %v", err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

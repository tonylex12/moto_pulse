package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"backend_go/db"
	"backend_go/middleware"
	"github.com/go-chi/chi/v5"
)

type CreateRouteInput struct {
	Name         string            `json:"name"`
	Coordinates  []RouteCoordinate `json:"coordinates"`
	StartPoint   *string           `json:"startPoint"`
	EndPoint     *string           `json:"endPoint"`
	Distance     *float64          `json:"distance"`
	Notes        *string           `json:"notes"`
	MaxSpeed     *float64          `json:"maxSpeed"`
	MaxLeftLean  *float64          `json:"maxLeftLean"`
	MaxRightLean *float64          `json:"maxRightLean"`
}

type RouteCoordinate struct {
	Latitude  float64  `json:"latitude"`
	Longitude float64  `json:"longitude"`
	Speed     *float64 `json:"speed,omitempty"`
	LeanAngle *float64 `json:"leanAngle,omitempty"`
	Time      *float64 `json:"time,omitempty"`
}

// GetRoutes lists all routes saved by the authenticated user
func GetRoutes(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var routes []db.SavedRoute
	err = db.DB.Where("\"userId\" = ?", clerkId).Order("\"createdAt\" desc").Find(&routes).Error
	if err != nil {
		http.Error(w, `{"error":"Failed to fetch saved routes"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(routes)
}

// CreateRoute registers a GPS route log
func CreateRoute(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var input CreateRouteInput
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.Name) == "" || len(input.Coordinates) == 0 || len(input.Coordinates) > 20000 {
		http.Error(w, `{"error":"Invalid request payload"}`, http.StatusBadRequest)
		return
	}
	if len([]rune(input.Name)) > 100 {
		http.Error(w, `{"error":"Route name is too long"}`, http.StatusBadRequest)
		return
	}
	for _, point := range input.Coordinates {
		if point.Latitude < -90 || point.Latitude > 90 || point.Longitude < -180 || point.Longitude > 180 {
			http.Error(w, `{"error":"Invalid route coordinates"}`, http.StatusBadRequest)
			return
		}
	}

	// Marshal coordinates payload to JSON raw bytes
	coordBytes, err := json.Marshal(input.Coordinates)
	if err != nil {
		http.Error(w, `{"error":"Invalid coordinates format"}`, http.StatusBadRequest)
		return
	}

	route := db.SavedRoute{
		Name:         input.Name,
		Coordinates:  db.JSON(coordBytes),
		StartPoint:   input.StartPoint,
		EndPoint:     input.EndPoint,
		Distance:     input.Distance,
		Notes:        input.Notes,
		MaxSpeed:     input.MaxSpeed,
		MaxLeftLean:  input.MaxLeftLean,
		MaxRightLean: input.MaxRightLean,
		UserID:       clerkId,
	}

	if err := db.DB.Create(&route).Error; err != nil {
		http.Error(w, `{"error":"Failed to save route"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(route)
}

// DeleteRoute deletes a saved route
func DeleteRoute(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
		return
	}

	id := chi.URLParam(r, "id")
	var route db.SavedRoute
	if err := db.DB.First(&route, "id = ?", id).Error; err != nil {
		http.Error(w, `{"error":"Route not found"}`, http.StatusNotFound)
		return
	}

	if route.UserID != clerkId {
		http.Error(w, `{"error":"Forbidden"}`, http.StatusForbidden)
		return
	}

	if err := db.DB.Delete(&route).Error; err != nil {
		http.Error(w, `{"error":"Failed to delete route"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true,"message":"Route deleted"}`))
}

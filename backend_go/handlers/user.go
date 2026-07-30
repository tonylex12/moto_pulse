package handlers

import (
	"encoding/json"
	"net/http"

	"backend_go/db"
	"backend_go/middleware"
)

type UserSyncInput struct {
	Email string `json:"email"`
}

type PushTokenInput struct {
	ExpoPushToken string `json:"expoPushToken"`
}

// SyncUser upserts the user authenticated via Clerk in PostgreSQL
func SyncUser(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized: User ID missing from context"}`, http.StatusUnauthorized)
		return
	}

	var input UserSyncInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.Email == "" {
		http.Error(w, `{"error":"Invalid request: email is required"}`, http.StatusBadRequest)
		return
	}

	user := db.User{
		ClerkID: clerkId,
		Email:   input.Email,
	}

	// Upsert User in database
	result := db.DB.Where(db.User{ClerkID: clerkId}).
		Assign(db.User{Email: input.Email}).
		FirstOrCreate(&user)

	if result.Error != nil {
		http.Error(w, `{"error":"Internal Server Error: Failed to sync user"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"user":    user,
	})
}

// UpdatePushToken updates the Expo Push Token for the authenticated user
func UpdatePushToken(w http.ResponseWriter, r *http.Request) {
	clerkId, err := middleware.GetClerkUserID(r.Context())
	if err != nil {
		http.Error(w, `{"error":"Unauthorized: User ID missing from context"}`, http.StatusUnauthorized)
		return
	}

	var input PushTokenInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.ExpoPushToken == "" {
		http.Error(w, `{"error":"Invalid request: expoPushToken is required"}`, http.StatusBadRequest)
		return
	}

	var user db.User
	result := db.DB.Model(&db.User{}).
		Where("\"clerkId\" = ?", clerkId).
		Update("\"expoPushToken\"", input.ExpoPushToken)

	if result.Error != nil {
		http.Error(w, `{"error":"Internal Server Error: Failed to update push token"}`, http.StatusInternalServerError)
		return
	}

	// Retrieve updated user to return
	db.DB.First(&user, "\"clerkId\" = ?", clerkId)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Push token updated successfully",
		"user":    user,
	})
}

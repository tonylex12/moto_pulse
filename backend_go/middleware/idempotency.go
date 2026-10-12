package middleware

import (
	"bytes"
	"net/http"
	"strings"
	"time"

	"backend_go/db"
	"gorm.io/gorm/clause"
)

type capturedResponse struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (w *capturedResponse) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *capturedResponse) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	_, _ = w.body.Write(data)
	return w.ResponseWriter.Write(data)
}

// Idempotency makes authenticated mutation retries safe. Clients provide a
// stable Idempotency-Key for every durable outbox operation.
func Idempotency(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		if key == "" {
			next.ServeHTTP(w, r)
			return
		}
		if len(key) > 200 {
			http.Error(w, `{"error":"Invalid idempotency key"}`, http.StatusBadRequest)
			return
		}
		userID, err := GetClerkUserID(r.Context())
		if err != nil {
			http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
			return
		}

		record := db.IdempotencyRecord{UserID: userID, Key: key, Method: r.Method, Path: r.URL.Path}
		result := db.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&record)
		if result.Error != nil {
			http.Error(w, `{"error":"Idempotency unavailable"}`, http.StatusInternalServerError)
			return
		}
		if result.RowsAffected == 0 {
			if err := db.DB.Where(`"userId" = ? AND key = ?`, userID, key).First(&record).Error; err != nil {
				http.Error(w, `{"error":"Idempotency unavailable"}`, http.StatusInternalServerError)
				return
			}
			if record.Method != r.Method || record.Path != r.URL.Path {
				http.Error(w, `{"error":"Idempotency key reused for another operation"}`, http.StatusConflict)
				return
			}
			if record.StatusCode == 0 {
				if time.Since(record.CreatedAt) < 5*time.Minute {
					http.Error(w, `{"error":"Operation is already processing"}`, http.StatusConflict)
					return
				}
				_ = db.DB.Delete(&record).Error
				Idempotency(next).ServeHTTP(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Idempotency-Replayed", "true")
			w.WriteHeader(record.StatusCode)
			_, _ = w.Write(record.ResponseBody)
			return
		}

		captured := &capturedResponse{ResponseWriter: w}
		next.ServeHTTP(captured, r)
		status := captured.status
		if status == 0 {
			status = http.StatusOK
		}
		_ = db.DB.Model(&record).Updates(map[string]interface{}{"statusCode": status, "responseBody": captured.body.Bytes()}).Error
	})
}

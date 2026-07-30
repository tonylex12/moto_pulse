package push

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// ExpoPushMessage represents the payload sent to Expo push service
type ExpoPushMessage struct {
	To    string                 `json:"to"`
	Sound string                 `json:"sound,omitempty"`
	Title string                 `json:"title"`
	Body  string                 `json:"body"`
	Data  map[string]interface{} `json:"data,omitempty"`
}

// IsExpoPushToken checks if a token matches the Expo token pattern
func IsExpoPushToken(token string) bool {
	return strings.HasPrefix(token, "ExponentPushToken[") && strings.HasSuffix(token, "]")
}

// SendPushNotification sends a push notification to Expo devices
func SendPushNotification(expoPushToken, title, body string, data map[string]interface{}) error {
	if !IsExpoPushToken(expoPushToken) {
		return fmt.Errorf("token %s is not a valid Expo push token", expoPushToken)
	}

	messages := []ExpoPushMessage{
		{
			To:    expoPushToken,
			Sound: "default",
			Title: title,
			Body:  body,
			Data:  data,
		},
	}

	bodyBytes, err := json.Marshal(messages)
	if err != nil {
		return fmt.Errorf("failed to marshal push messages: %w", err)
	}

	req, err := http.NewRequest("POST", "https://exp.host/--/api/v2/push/send", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip, deflate")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to dispatch request to Expo: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("expo push service returned status %d", resp.StatusCode)
	}

	log.Printf("Push notification dispatched successfully to token: %s", expoPushToken)
	return nil
}

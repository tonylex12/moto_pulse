package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	return (strings.HasPrefix(token, "ExponentPushToken[") || strings.HasPrefix(token, "ExpoPushToken[")) && strings.HasSuffix(token, "]")
}

// SendPushNotification sends a push notification to Expo devices
func SendPushNotification(expoPushToken, title, body string, data map[string]interface{}) error {
	return (Client{HTTP: &http.Client{Timeout: 10 * time.Second}, Endpoint: "https://exp.host/--/api/v2/push/send"}).Send(expoPushToken, title, body, data)
}

// Client allows a simulated push endpoint in tests without altering production globals.
type Client struct {
	HTTP     *http.Client
	Endpoint string
}

func (client Client) Send(expoPushToken, title, body string, data map[string]interface{}) error {
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

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", client.Endpoint, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := client.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("failed to dispatch request to Expo: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("expo push service returned status %d", resp.StatusCode)
	}

	var result struct {
		Data []struct {
			Status string `json:"status"`
			ID     string `json:"id"`
		} `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return fmt.Errorf("invalid Expo ticket response: %w", err)
	}
	if len(result.Errors) != 0 || len(result.Data) != 1 || result.Data[0].Status != "ok" || result.Data[0].ID == "" {
		return fmt.Errorf("Expo did not accept the notification")
	}
	return nil
}

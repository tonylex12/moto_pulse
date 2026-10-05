package push

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSendRequiresAcceptedTicket(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		accepted   bool
	}{
		{"accepted", `{"data":[{"status":"ok","id":"ticket-1"}]}`, 200, true},
		{"ticket error", `{"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}}]}`, 200, false},
		{"missing id", `{"data":[{"status":"ok"}]}`, 200, false},
		{"empty body", `{}`, 200, false},
		{"invalid JSON", `invalid`, 200, false},
		{"top level error", `{"data":[{"status":"ok","id":"x"}],"errors":[{}]}`, 200, false},
		{"HTTP error", `{"data":[{"status":"ok","id":"x"}]}`, 503, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := Client{Endpoint: "https://push.test", HTTP: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				if _, ok := r.Context().Deadline(); !ok {
					t.Error("missing HTTP timeout")
				}
				if r.Header.Get("Accept-Encoding") != "" {
					t.Error("explicit compression bypasses automatic decoding")
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
			})}}
			if err := client.Send("ExponentPushToken[test]", "title", "body", nil); (err == nil) != tc.accepted {
				t.Errorf("accepted=%v, error=%v", tc.accepted, err)
			}
		})
	}
}

func TestSendNetworkFailureAndTimeout(t *testing.T) {
	for _, timeout := range []bool{false, true} {
		client := Client{Endpoint: "https://push.test", HTTP: &http.Client{Timeout: 20 * time.Millisecond, Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
			if timeout {
				<-r.Context().Done()
				return nil, r.Context().Err()
			}
			return nil, errors.New("network unavailable")
		})}}
		if err := client.Send("ExpoPushToken[test]", "title", "body", nil); err == nil {
			t.Fatal("failure accepted")
		}
	}
}

func TestInvalidTokenDoesNotSend(t *testing.T) {
	client := Client{HTTP: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		t.Error("unexpected HTTP request")
		return nil, errors.New("unexpected")
	})}}
	if err := client.Send("invalid", "", "", nil); err == nil {
		t.Fatal("invalid token accepted")
	}
}

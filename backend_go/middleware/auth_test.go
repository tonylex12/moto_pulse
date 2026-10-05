package middleware

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func mockTransport(t *testing.T, f roundTripFunc) {
	t.Helper()
	previous := http.DefaultTransport
	http.DefaultTransport = f
	jwkMutex.Lock()
	jwkCache = make(map[string]jwkCacheEntry)
	jwkMutex.Unlock()
	t.Cleanup(func() {
		http.DefaultTransport = previous
		jwkMutex.Lock()
		jwkCache = make(map[string]jwkCacheEntry)
		jwkMutex.Unlock()
	})
}

func publishableKey(domain string) string {
	return "pk_test_" + base64.RawStdEncoding.EncodeToString([]byte(domain+"$"))
}

func testKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func signedToken(t *testing.T, key *rsa.PrivateKey, claims jwt.MapClaims, kid string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func jwksBody(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	body, err := json.Marshal(JWKS{Keys: []JWK{{
		Kty: "RSA", Kid: "test-key", Use: "sig", Alg: "RS256",
		N: base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		E: base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
	}}})
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func httpResponse(r *http.Request, status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}
}

func TestForeignIssuerNeverFetchesKeys(t *testing.T) {
	key := testKey(t)
	claims := jwt.MapClaims{"iss": "https://attacker.example", "sub": "victim", "exp": time.Now().Add(time.Hour).Unix()}
	token := signedToken(t, key, claims, "test-key")
	// Establish that the adversary's token really has a valid signature.
	if _, err := jwt.Parse(token, func(*jwt.Token) (interface{}, error) { return &key.PublicKey, nil }); err != nil {
		t.Fatal(err)
	}
	for _, env := range []string{"", "development", "production"} {
		t.Run("GO_ENV="+env, func(t *testing.T) {
			t.Setenv("CLERK_PUBLISHABLE_KEY", publishableKey("trusted.example"))
			t.Setenv("GO_ENV", env)
			requests := 0
			body := jwksBody(t, key)
			mockTransport(t, func(r *http.Request) (*http.Response, error) {
				requests++
				return httpResponse(r, http.StatusOK, body), nil
			})
			called := false
			auth, err := NewClerkAuth()
			if err != nil {
				t.Fatal(err)
			}
			handler := auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(http.StatusNoContent) }))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", response.Code)
			}
			if requests != 0 {
				t.Errorf("JWKS requests = %d, want 0", requests)
			}
			if called {
				t.Error("protected handler executed")
			}
		})
	}
}

func TestJWKSDoesNotFollowRedirects(t *testing.T) {
	requests := 0
	key := testKey(t)
	body := jwksBody(t, key)
	mockTransport(t, func(r *http.Request) (*http.Response, error) {
		requests++
		if r.URL.Host == "trusted.example" {
			response := httpResponse(r, http.StatusFound, "")
			response.Header.Set("Location", "https://attacker.example/keys")
			return response, nil
		}
		return httpResponse(r, http.StatusOK, body), nil
	})
	if _, err := getIssuerPublicKeys("https://trusted.example"); err == nil {
		t.Error("redirect accepted")
	}
	if requests != 1 {
		t.Errorf("requests = %d, want only the configured endpoint", requests)
	}
}

func TestClerkAuthConfiguration(t *testing.T) {
	encoded := func(value string) string { return "pk_test_" + base64.RawStdEncoding.EncodeToString([]byte(value)) }
	for _, tc := range []struct{ name, key, issuer string }{
		{"missing", "", ""},
		{"placeholder", "pk_test_placeholder", ""},
		{"wrong prefix", strings.Replace(publishableKey("trusted.example"), "pk_", "sk_", 1), ""},
		{"wrong environment", strings.Replace(publishableKey("trusted.example"), "test_", "dev_", 1), ""},
		{"invalid base64", "pk_test_!", ""},
		{"empty domain", encoded("$"), ""},
		{"missing terminator", encoded("trusted.example"), ""},
		{"extra terminator", encoded("trusted.example$$"), ""},
		{"scheme", publishableKey("http://trusted.example"), ""},
		{"credentials", publishableKey("user@trusted.example"), ""},
		{"port", publishableKey("trusted.example:443"), ""},
		{"path", publishableKey("trusted.example/path"), ""},
		{"query", publishableKey("trusted.example?x=1"), ""},
		{"fragment", publishableKey("trusted.example#x"), ""},
		{"empty label", publishableKey("trusted..example"), ""},
		{"invalid label", publishableKey("-trusted.example"), ""},
		{"long label", publishableKey(strings.Repeat("a", 64) + ".example"), ""},
		{"long domain", publishableKey(strings.Repeat(strings.Repeat("a", 63)+".", 4) + "example"), ""},
		{"test", publishableKey("trusted.example"), "https://trusted.example"},
		{"live", strings.Replace(publishableKey("trusted.example"), "test_", "live_", 1), "https://trusted.example"},
		{"padded base64", "pk_test_" + base64.StdEncoding.EncodeToString([]byte("trusted.example$")), "https://trusted.example"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CLERK_PUBLISHABLE_KEY", tc.key)
			requests := 0
			mockTransport(t, func(r *http.Request) (*http.Response, error) {
				requests++
				return nil, errors.New("unexpected request")
			})
			issuer, err := getTrustedIssuer()
			if issuer != tc.issuer {
				t.Errorf("issuer = %q, want %q", issuer, tc.issuer)
			}
			auth, constructorErr := NewClerkAuth()
			if tc.issuer == "" {
				if err == nil || constructorErr == nil || auth != nil {
					t.Error("invalid configuration did not fail closed")
				}
			} else if err != nil || constructorErr != nil || auth == nil {
				t.Fatalf("valid configuration rejected: %v, %v", err, constructorErr)
			}
			if requests != 0 {
				t.Errorf("configuration caused %d HTTP requests", requests)
			}
		})
	}
}

func TestClerkAuthTokenValidation(t *testing.T) {
	key, otherKey := testKey(t), testKey(t)
	for _, name := range []string{
		"valid", "missing authorization", "wrong authorization scheme", "malformed token",
		"missing issuer", "http issuer", "subdomain issuer", "port issuer", "path issuer", "trailing slash issuer",
		"wrong signature", "unknown kid", "non RSA algorithm", "expired", "not yet valid", "missing subject",
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("CLERK_PUBLISHABLE_KEY", publishableKey("trusted.example"))
			claims := jwt.MapClaims{"iss": "https://trusted.example", "sub": "user_test", "exp": time.Now().Add(time.Hour).Unix()}
			signingKey, kid := key, "test-key"
			wantRequests := 1
			switch name {
			case "missing issuer":
				delete(claims, "iss")
				wantRequests = 0
			case "http issuer":
				claims["iss"] = "http://trusted.example"
				wantRequests = 0
			case "subdomain issuer":
				claims["iss"] = "https://sub.trusted.example"
				wantRequests = 0
			case "port issuer":
				claims["iss"] = "https://trusted.example:443"
				wantRequests = 0
			case "path issuer":
				claims["iss"] = "https://trusted.example/path"
				wantRequests = 0
			case "trailing slash issuer":
				claims["iss"] = "https://trusted.example/"
				wantRequests = 0
			case "wrong signature":
				signingKey = otherKey
			case "unknown kid":
				kid = "unknown"
			case "expired":
				claims["exp"] = time.Now().Add(-time.Hour).Unix()
			case "not yet valid":
				claims["nbf"] = time.Now().Add(time.Hour).Unix()
			case "missing subject":
				delete(claims, "sub")
			}
			token := signedToken(t, signingKey, claims, kid)
			if name == "non RSA algorithm" {
				var err error
				token, err = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
				if err != nil {
					t.Fatal(err)
				}
			}
			header := "Bearer " + token
			switch name {
			case "missing authorization":
				header = ""
				wantRequests = 0
			case "wrong authorization scheme":
				header = "Basic " + token
				wantRequests = 0
			case "malformed token":
				header = "Bearer invalid"
				wantRequests = 0
			}
			requests := 0
			body := jwksBody(t, key)
			mockTransport(t, func(r *http.Request) (*http.Response, error) {
				requests++
				if r.URL.String() != "https://trusted.example/.well-known/jwks.json" {
					t.Errorf("unexpected JWKS destination: %s", r.URL)
				}
				return httpResponse(r, http.StatusOK, body), nil
			})
			auth, err := NewClerkAuth()
			if err != nil {
				t.Fatal(err)
			}
			called := false
			handler := auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				sub, err := GetClerkUserID(r.Context())
				if err != nil || sub != "user_test" {
					t.Errorf("verified subject = %q, error = %v", sub, err)
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			// Subsequent environment changes cannot replace the configured issuer.
			t.Setenv("CLERK_PUBLISHABLE_KEY", publishableKey("changed.example"))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("Authorization", header)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			wantStatus := http.StatusUnauthorized
			if name == "valid" {
				wantStatus = http.StatusNoContent
			}
			if response.Code != wantStatus {
				t.Errorf("status = %d, want %d", response.Code, wantStatus)
			}
			if called != (name == "valid") {
				t.Errorf("handler executed = %v", called)
			}
			if requests != wantRequests {
				t.Errorf("requests = %d, want %d", requests, wantRequests)
			}
			if name == "valid" {
				handler.ServeHTTP(httptest.NewRecorder(), req)
				if requests != 1 {
					t.Error("cached keys fetched again")
				}
			}
		})
	}
}

func TestClerkAuthJWKSFailures(t *testing.T) {
	key := testKey(t)
	token := signedToken(t, key, jwt.MapClaims{"iss": "https://trusted.example", "sub": "user_test", "exp": time.Now().Add(time.Hour).Unix()}, "test-key")
	for _, name := range []string{"redirect", "HTTP error", "invalid JSON", "network error"} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("CLERK_PUBLISHABLE_KEY", publishableKey("trusted.example"))
			requests := 0
			mockTransport(t, func(r *http.Request) (*http.Response, error) {
				requests++
				if r.URL.String() != "https://trusted.example/.well-known/jwks.json" {
					t.Errorf("unexpected destination: %s", r.URL)
				}
				switch name {
				case "redirect":
					response := httpResponse(r, http.StatusFound, "")
					response.Header.Set("Location", "https://attacker.example/keys")
					return response, nil
				case "HTTP error":
					return httpResponse(r, http.StatusInternalServerError, ""), nil
				case "invalid JSON":
					return httpResponse(r, http.StatusOK, "invalid"), nil
				default:
					return nil, errors.New("network unavailable")
				}
			})
			auth, err := NewClerkAuth()
			if err != nil {
				t.Fatal(err)
			}
			called := false
			handler := auth(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != http.StatusUnauthorized || called || requests != 1 {
				t.Errorf("status=%d, handler=%v, requests=%d", response.Code, called, requests)
			}
		})
	}
}

package middleware

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const ClerkUserKey contextKey = "clerkUserId"

// JWK representation matching Clerk's public keys format
type JWK struct {
	Kty string   `json:"kty"`
	Kid string   `json:"kid"`
	Use string   `json:"use"`
	Alg string   `json:"alg"`
	N   string   `json:"n"`
	E   string   `json:"e"`
	X5c []string `json:"x5c"`
}

type JWKS struct {
	Keys []JWK `json:"keys"`
}

type jwkCacheEntry struct {
	Keys      map[string]*rsa.PublicKey
	FetchedAt time.Time
}

var (
	jwkCache = make(map[string]jwkCacheEntry)
	jwkMutex sync.RWMutex
)

// Helper to convert JWK components (N and E) to an RSA Public Key
func jwkToRSAPublicKey(jwk JWK) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return nil, fmt.Errorf("failed to decode modulus: %w", err)
	}
	
	eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return nil, fmt.Errorf("failed to decode exponent: %w", err)
	}

	var e int
	for _, b := range eBytes {
		e = (e << 8) + int(b)
	}

	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: e,
	}, nil
}

// Extracts the trusted Clerk domain from the publishable key
func getTrustedIssuerDomain() string {
	pubKey := os.Getenv("CLERK_PUBLISHABLE_KEY")
	if pubKey == "" {
		return ""
	}
	
	parts := strings.Split(pubKey, "_")
	if len(parts) < 3 {
		return ""
	}
	
	encoded := parts[2]
	switch len(encoded) % 4 {
	case 2:
		encoded += "=="
	case 3:
		encoded += "="
	}
	
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}
	
	domain := string(decoded)
	if idx := strings.Index(domain, "$"); idx != -1 {
		domain = domain[:idx]
	}
	return domain
}

// Fetches and caches JWKS from the Clerk issuer URL
func getIssuerPublicKeys(issuer string) (map[string]*rsa.PublicKey, error) {
	jwkMutex.RLock()
	entry, exists := jwkCache[issuer]
	jwkMutex.RUnlock()

	// If keys exist and are fresher than 1 hour, use them
	if exists && time.Since(entry.FetchedAt) < 1*time.Hour {
		return entry.Keys, nil
	}

	// Fetch new keys
	jwkMutex.Lock()
	defer jwkMutex.Unlock()

	// Double check lock condition
	entry, exists = jwkCache[issuer]
	if exists && time.Since(entry.FetchedAt) < 1*time.Hour {
		return entry.Keys, nil
	}

	jwksURL := fmt.Sprintf("%s/.well-known/jwks.json", strings.TrimSuffix(issuer, "/"))
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JWKS from %s: %w", jwksURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching JWKS returned status %d", resp.StatusCode)
	}

	var jwks JWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("failed to decode JWKS: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey)
	for _, jwk := range jwks.Keys {
		pubKey, err := jwkToRSAPublicKey(jwk)
		if err != nil {
			continue
		}
		keys[jwk.Kid] = pubKey
	}

	jwkCache[issuer] = jwkCacheEntry{
		Keys:      keys,
		FetchedAt: time.Now(),
	}

	return keys, nil
}

// RequireClerkAuth is a middleware that enforces and validates Clerk JWT session tokens
func RequireClerkAuth(next http.Handler) http.Handler {
	trustedDomain := getTrustedIssuerDomain()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, `{"error":"Unauthorized: Missing or invalid Authorization header"}`, http.StatusUnauthorized)
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		
		// Parse without validating signature first to extract headers and claims (specifically the issuer 'iss')
		parser := jwt.NewParser()
		token, _, err := parser.ParseUnverified(tokenStr, jwt.MapClaims{})
		if err != nil {
			http.Error(w, `{"error":"Unauthorized: Invalid token format"}`, http.StatusUnauthorized)
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			http.Error(w, `{"error":"Unauthorized: Invalid claims format"}`, http.StatusUnauthorized)
			return
		}

		iss, _ := claims["iss"].(string)
		if iss == "" {
			http.Error(w, `{"error":"Unauthorized: Missing issuer claim"}`, http.StatusUnauthorized)
			return
		}

		// Security check: Verify the issuer domain matches our trusted Clerk domain
		if trustedDomain != "" {
			issURL, err := url.Parse(iss)
			if err != nil || (issURL.Host != trustedDomain && !strings.HasSuffix(issURL.Host, "."+trustedDomain)) {
				// Allow bypass in local development if environment says so, but enforce strictly otherwise
				if os.Getenv("GO_ENV") == "production" {
					http.Error(w, `{"error":"Unauthorized: Untrusted token issuer"}`, http.StatusUnauthorized)
					return
				}
			}
		}

		// Retrieve public keys for this issuer
		publicKeys, err := getIssuerPublicKeys(iss)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"Unauthorized: Failed to load public keys: %s"}`, err.Error()), http.StatusUnauthorized)
			return
		}

		// Verify the JWT signature and claims validity
		parsedToken, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			kid, _ := t.Header["kid"].(string)
			pubKey, ok := publicKeys[kid]
			if !ok {
				return nil, fmt.Errorf("key ID %s not found in JWKS", kid)
			}
			return pubKey, nil
		})

		if err != nil || !parsedToken.Valid {
			http.Error(w, `{"error":"Unauthorized: Invalid or expired token"}`, http.StatusUnauthorized)
			return
		}

		// Extract Clerk User ID (sub claim)
		sub, _ := claims["sub"].(string)
		if sub == "" {
			http.Error(w, `{"error":"Unauthorized: Missing sub (User ID) claim"}`, http.StatusUnauthorized)
			return
		}

		// Inject User ID into context
		ctx := context.WithValue(r.Context(), ClerkUserKey, sub)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetClerkUserID retrieves the Clerk User ID from the context
func GetClerkUserID(ctx context.Context) (string, error) {
	userId, ok := ctx.Value(ClerkUserKey).(string)
	if !ok || userId == "" {
		return "", errors.New("clerk user ID missing from context")
	}
	return userId, nil
}

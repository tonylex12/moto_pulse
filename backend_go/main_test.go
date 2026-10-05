package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestStartupRejectsInvalidClerkConfiguration(t *testing.T) {
	for _, key := range []string{"", "pk_test_invalid"} {
		t.Run("key="+key, func(t *testing.T) {
			cmd := exec.Command(os.Args[0], "-test.run=^TestStartupHelper$")
			// A clean working directory prevents loading the project's .env.
			cmd.Dir = t.TempDir()
			for _, value := range os.Environ() {
				if strings.HasPrefix(value, "CLERK_PUBLISHABLE_KEY=") || strings.HasPrefix(value, "DATABASE_URL=") || strings.HasPrefix(value, "MOTOPULSE_STARTUP_TEST=") {
					continue
				}
				cmd.Env = append(cmd.Env, value)
			}
			cmd.Env = append(cmd.Env, "MOTOPULSE_STARTUP_TEST=1", "CLERK_PUBLISHABLE_KEY="+key, "DATABASE_URL=")
			output, err := cmd.CombinedOutput()
			if err == nil {
				t.Fatal("server did not fail at startup")
			}
			if !strings.Contains(string(output), "Invalid Clerk authentication configuration:") {
				t.Fatalf("unexpected startup error: %s", output)
			}
			if strings.Contains(string(output), "DATABASE_URL must be set") || strings.Contains(string(output), "Connecting to database") {
				t.Fatalf("database initialization reached: %s", output)
			}
		})
	}
}

func TestStartupHelper(t *testing.T) {
	if os.Getenv("MOTOPULSE_STARTUP_TEST") == "1" {
		main()
	}
}

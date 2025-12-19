package backend

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// getSpotiDownloaderDir returns the path to ~/.spotidownloader directory
func getSpotiDownloaderDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user home directory: %v", err)
	}
	return filepath.Join(homeDir, ".spotidownloader"), nil
}

// FetchSessionToken menjalankan get_token dan mengembalikan session token
func FetchSessionToken() (string, error) {
	return FetchSessionTokenWithParams(5, 1)
}

// FetchSessionTokenWithParams menjalankan get_token dengan parameter timeout dan retry
func FetchSessionTokenWithParams(timeout int, retry int) (string, error) {
	// Get the .spotidownloader directory path
	spotiDir, err := getSpotiDownloaderDir()
	if err != nil {
		return "", err
	}

	// Create directory if it doesn't exist
	if err := os.MkdirAll(spotiDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create .spotidownloader directory: %v", err)
	}

	// Get the appropriate binary for current OS (defined in platform-specific files)
	binaryData, binaryName := getTokenBinary()
	exePath := filepath.Join(spotiDir, binaryName)

	// Check if binary already exists and has the same size
	needsUpdate := true
	if info, err := os.Stat(exePath); err == nil {
		if info.Size() == int64(len(binaryData)) {
			needsUpdate = false
		}
	}

	// Write binary if needed
	if needsUpdate {
		err = os.WriteFile(exePath, binaryData, 0755)
		if err != nil {
			return "", fmt.Errorf("failed to write get_token binary: %v", err)
		}
	}

	// Retry logic at Go level (in case binary doesn't handle retry properly on some platforms)
	var lastErr error
	maxAttempts := retry
	if maxAttempts < 1 {
		maxAttempts = 1
	}

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		fmt.Printf("[TokenFetcher] Attempt %d/%d (timeout: %ds)\n", attempt, maxAttempts, timeout)

		// Run executable with timeout parameter only, retry handled here
		cmd := exec.Command(exePath, "--timeout", fmt.Sprintf("%d", timeout), "--retry", "1")
		output, err := cmd.CombinedOutput()
		outputStr := strings.TrimSpace(string(output))

		if err != nil {
			lastErr = fmt.Errorf("get_token execution failed (attempt %d): %v, output: %s", attempt, err, outputStr)
			fmt.Printf("[TokenFetcher] %v\n", lastErr)
			if attempt < maxAttempts {
				time.Sleep(1 * time.Second)
			}
			continue
		}

		// Check if output is empty
		if outputStr == "" {
			lastErr = fmt.Errorf("get_token returned empty output (attempt %d)", attempt)
			fmt.Printf("[TokenFetcher] %v\n", lastErr)
			if attempt < maxAttempts {
				time.Sleep(1 * time.Second)
			}
			continue
		}

		// Validate token (must start with eyJ for JWT)
		if !strings.HasPrefix(outputStr, "eyJ") {
			lastErr = fmt.Errorf("get_token returned invalid token (attempt %d): %s", attempt, outputStr)
			fmt.Printf("[TokenFetcher] %v\n", lastErr)
			if attempt < maxAttempts {
				time.Sleep(1 * time.Second)
			}
			continue
		}

		fmt.Printf("[TokenFetcher] Token fetched successfully on attempt %d\n", attempt)
		return outputStr, nil
	}

	return "", fmt.Errorf("failed to fetch token after %d attempts: %v", maxAttempts, lastErr)
}

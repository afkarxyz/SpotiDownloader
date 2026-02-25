package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func getSpotiDownloaderDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user home directory: %v", err)
	}
	return filepath.Join(homeDir, ".spotidownloader"), nil
}

func FetchSessionToken() (string, error) {
	return FetchSessionTokenWithParams(5, 1)
}

var ErrChromeNotInstalled = fmt.Errorf("chrome_not_installed")

func FetchSessionTokenWithParams(timeout int, retry int) (string, error) {

	chromeInstalled, _, err := IsChromeInstalled()
	if err != nil {
		return "", fmt.Errorf("failed to check Chrome installation: %v", err)
	}
	if !chromeInstalled {
		return "", ErrChromeNotInstalled
	}

	spotiDir, err := getSpotiDownloaderDir()
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(spotiDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create .spotidownloader directory: %v", err)
	}

	binaryData, binaryName := getTokenBinary()
	exePath := filepath.Join(spotiDir, binaryName)

	needsUpdate := true
	if info, err := os.Stat(exePath); err == nil {
		if info.Size() == int64(len(binaryData)) {
			needsUpdate = false
		}
	}

	if needsUpdate {
		err = os.WriteFile(exePath, binaryData, 0755)
		if err != nil {
			return "", fmt.Errorf("failed to write get_token binary: %v", err)
		}
	}

	var lastErr error
	if retry < 0 {
		retry = 0
	}
	maxAttempts := retry + 1

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		fmt.Printf("[TokenFetcher] Attempt %d/%d (timeout: %ds)\n", attempt, maxAttempts, timeout)

		cmd := newTokenCmd(exePath, "--timeout", fmt.Sprintf("%d", timeout), "--retry", "1")
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

		if outputStr == "" {
			lastErr = fmt.Errorf("get_token returned empty output (attempt %d)", attempt)
			fmt.Printf("[TokenFetcher] %v\n", lastErr)
			if attempt < maxAttempts {
				time.Sleep(1 * time.Second)
			}
			continue
		}

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

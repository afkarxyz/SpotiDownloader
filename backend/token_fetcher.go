package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type TokenResponse struct {
	Token string `json:"token"`
}

func FetchSessionToken() (string, error) {
	var lastErr error
	maxAttempts := 3
	timeout := 10

	client := &http.Client{
		Timeout: time.Duration(timeout) * time.Second,
	}

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		fmt.Printf("[TokenFetcher] Attempt %d/%d (timeout: %ds)\n", attempt, maxAttempts, timeout)

		req, err := http.NewRequest("GET", "https://spdl.afkarxyz.fun/token", nil)
		if err != nil {
			lastErr = fmt.Errorf("failed to create request: %v", err)
			continue
		}

		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed (attempt %d): %v", attempt, err)
			fmt.Printf("[TokenFetcher] %v\n", lastErr)
			if attempt < maxAttempts {
				time.Sleep(1 * time.Second)
			}
			continue
		}

		defer resp.Body.Close()
		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			lastErr = fmt.Errorf("failed to read response body: %v", err)
			if attempt < maxAttempts {
				time.Sleep(1 * time.Second)
			}
			continue
		}

		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("unexpected status code: %d, body: %s", resp.StatusCode, string(bodyBytes))
			fmt.Printf("[TokenFetcher] %v\n", lastErr)
			if attempt < maxAttempts {
				time.Sleep(1 * time.Second)
			}
			continue
		}

		var tokenResp TokenResponse
		if err := json.Unmarshal(bodyBytes, &tokenResp); err != nil {
			lastErr = fmt.Errorf("failed to decode JSON response: %v, body: %s", err, string(bodyBytes))
			fmt.Printf("[TokenFetcher] %v\n", lastErr)
			if attempt < maxAttempts {
				time.Sleep(1 * time.Second)
			}
			continue
		}

		if tokenResp.Token == "" {
			lastErr = fmt.Errorf("get_token returned empty token in JSON (attempt %d)", attempt)
			fmt.Printf("[TokenFetcher] %v\n", lastErr)
			if attempt < maxAttempts {
				time.Sleep(1 * time.Second)
			}
			continue
		}

		fmt.Printf("[TokenFetcher] Token fetched successfully on attempt %d\n", attempt)
		return tokenResp.Token, nil
	}

	return "", fmt.Errorf("failed to fetch token after %d attempts: %v", maxAttempts, lastErr)
}

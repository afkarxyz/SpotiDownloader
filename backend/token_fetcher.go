package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type TokenResponse struct {
	Token     string `json:"token"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

type tokenCacheFile struct {
	Token     string `json:"token"`
	UpdatedAt string `json:"updated_at,omitempty"`
	FetchedAt string `json:"fetched_at,omitempty"`
	Source    string `json:"source,omitempty"`
}

const (
	sessionTokenCacheTTL    = 60 * time.Second
	sessionTokenFallbackTTL = 10 * time.Minute
	sessionTokenSourceURL   = "https://gist.githubusercontent.com/afkarxyz/c1f20e26287341485c3aaab2225cb367/raw"
	sessionTokenCacheDir    = ".spotidownloader"
	sessionTokenLegacyDir   = ".spotidownlaoder"
	sessionTokenCacheFile   = "session_token.json"
)

var (
	sessionTokenCacheMu sync.Mutex
	cachedSessionToken  string
	cachedSessionAt     time.Time
)

func getSessionTokenCachePath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}

	cacheDir := filepath.Join(homeDir, sessionTokenCacheDir)
	if err := migrateLegacySessionTokenCache(homeDir, cacheDir); err != nil {
		fmt.Printf("[TokenFetcher] Warning: failed to migrate legacy token cache: %v\n", err)
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create token cache directory: %w", err)
	}

	return filepath.Join(cacheDir, sessionTokenCacheFile), nil
}

func migrateLegacySessionTokenCache(homeDir string, cacheDir string) error {
	legacyDir := filepath.Join(homeDir, sessionTokenLegacyDir)
	if legacyDir == cacheDir {
		return nil
	}

	legacyPath := filepath.Join(legacyDir, sessionTokenCacheFile)
	newPath := filepath.Join(cacheDir, sessionTokenCacheFile)

	if _, err := os.Stat(legacyPath); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	if _, err := os.Stat(newPath); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}

	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return err
	}

	if err := os.Rename(legacyPath, newPath); err != nil {
		return err
	}

	entries, err := os.ReadDir(legacyDir)
	if err == nil && len(entries) == 0 {
		_ = os.Remove(legacyDir)
	}

	return nil
}

func loadSessionTokenCacheFile() (*tokenCacheFile, error) {
	cachePath, err := getSessionTokenCachePath()
	if err != nil {
		return nil, err
	}

	body, err := os.ReadFile(cachePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read token cache file: %w", err)
	}

	var cache tokenCacheFile
	if err := json.Unmarshal(body, &cache); err != nil {
		return nil, fmt.Errorf("failed to parse token cache file: %w", err)
	}

	return &cache, nil
}

func saveSessionTokenCacheFile(cache tokenCacheFile) error {
	cachePath, err := getSessionTokenCachePath()
	if err != nil {
		return err
	}

	body, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode token cache file: %w", err)
	}

	if err := os.WriteFile(cachePath, body, 0o644); err != nil {
		return fmt.Errorf("failed to write token cache file: %w", err)
	}

	return nil
}

func parseCachedFetchTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}

	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, false
	}

	return parsed, true
}

func tokenCacheAge(cache *tokenCacheFile) (time.Duration, bool) {
	if cache == nil {
		return 0, false
	}

	fetchedAt, ok := parseCachedFetchTime(cache.FetchedAt)
	if !ok {
		return 0, false
	}

	return time.Since(fetchedAt), true
}

func cacheSessionToken(token string, fetchedAt time.Time) {
	cachedSessionToken = token
	cachedSessionAt = fetchedAt
}

func FetchSessionToken() (string, error) {
	sessionTokenCacheMu.Lock()
	defer sessionTokenCacheMu.Unlock()

	if cachedSessionToken != "" && !cachedSessionAt.IsZero() {
		if age := time.Since(cachedSessionAt); age < sessionTokenCacheTTL {
			fmt.Printf("[TokenFetcher] Using cached token (age: %ds)\n", int(age.Seconds()))
			return cachedSessionToken, nil
		}
	}

	fileCache, err := loadSessionTokenCacheFile()
	if err != nil {
		fmt.Printf("[TokenFetcher] Warning: failed to load token cache file: %v\n", err)
	} else if fileCache != nil && strings.TrimSpace(fileCache.Token) != "" {
		if age, ok := tokenCacheAge(fileCache); ok && age < sessionTokenCacheTTL {
			fmt.Printf("[TokenFetcher] Using file-cached token (age: %ds)\n", int(age.Seconds()))
			cacheSessionToken(strings.TrimSpace(fileCache.Token), time.Now().Add(-age))
			return cachedSessionToken, nil
		}
	}

	var lastErr error
	maxAttempts := 3
	timeout := 10

	client := &http.Client{
		Timeout: time.Duration(timeout) * time.Second,
	}

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		fmt.Printf("[TokenFetcher] Attempt %d/%d (timeout: %ds)\n", attempt, maxAttempts, timeout)

		req, err := http.NewRequest("GET", sessionTokenSourceURL, nil)
		if err != nil {
			lastErr = fmt.Errorf("failed to create request: %v", err)
			continue
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "application/json")

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
		now := time.Now().UTC()
		cacheSessionToken(strings.TrimSpace(tokenResp.Token), now)
		cache := tokenCacheFile{
			Token:     strings.TrimSpace(tokenResp.Token),
			UpdatedAt: strings.TrimSpace(tokenResp.UpdatedAt),
			FetchedAt: now.Format(time.RFC3339),
			Source:    sessionTokenSourceURL,
		}
		if err := saveSessionTokenCacheFile(cache); err != nil {
			fmt.Printf("[TokenFetcher] Warning: failed to save token cache file: %v\n", err)
		}
		return tokenResp.Token, nil
	}

	if fileCache != nil && strings.TrimSpace(fileCache.Token) != "" {
		if age, ok := tokenCacheAge(fileCache); ok && age < sessionTokenFallbackTTL {
			fmt.Printf("[TokenFetcher] Using stale file-cached token after fetch failure (age: %ds)\n", int(age.Seconds()))
			cacheSessionToken(strings.TrimSpace(fileCache.Token), time.Now().Add(-age))
			return cachedSessionToken, nil
		}
	}

	return "", fmt.Errorf("failed to fetch token after %d attempts: %v", maxAttempts, lastErr)
}

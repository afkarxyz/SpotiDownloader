package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var AppVersion = "Unknown"

const (
	musicBrainzAPIBase               = "https://musicbrainz.org/ws/2"
	musicBrainzRequestTimeout        = 10 * time.Second
	musicBrainzRequestRetries        = 3
	musicBrainzRequestRetryWait      = 3 * time.Second
	musicBrainzMinRequestInterval    = 1100 * time.Millisecond
	musicBrainzThrottleCooldownOn503 = 5 * time.Second
	musicBrainzStatusCheckSkipWindow = 5 * time.Minute
)

type musicBrainzStatusError struct {
	StatusCode int
}

func (e *musicBrainzStatusError) Error() string {
	return fmt.Sprintf("MusicBrainz API returned status: %d", e.StatusCode)
}

type musicBrainzInflightCall struct {
	done   chan struct{}
	result Metadata
	err    error
}

var (
	musicBrainzCache      sync.Map
	musicBrainzInflightMu sync.Mutex
	musicBrainzInflight   = make(map[string]*musicBrainzInflightCall)

	musicBrainzThrottleMu  sync.Mutex
	musicBrainzNextRequest time.Time
	musicBrainzBlockedTill time.Time

	musicBrainzStatusMu          sync.RWMutex
	musicBrainzLastCheckedAt     time.Time
	musicBrainzLastCheckedOnline bool
)

func SetMusicBrainzStatusCheckResult(online bool) {
	musicBrainzStatusMu.Lock()
	defer musicBrainzStatusMu.Unlock()

	musicBrainzLastCheckedAt = time.Now()
	musicBrainzLastCheckedOnline = online
}

func ShouldSkipMusicBrainzMetadataFetch() bool {
	musicBrainzStatusMu.RLock()
	defer musicBrainzStatusMu.RUnlock()

	if musicBrainzLastCheckedAt.IsZero() {
		return false
	}

	if musicBrainzLastCheckedOnline {
		return false
	}

	return time.Since(musicBrainzLastCheckedAt) <= musicBrainzStatusCheckSkipWindow
}

type MusicBrainzRecordingResponse struct {
	Recordings []struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Length   int    `json:"length"`
		Releases []struct {
			ID           string `json:"id"`
			Title        string `json:"title"`
			Status       string `json:"status"`
			ReleaseGroup struct {
				ID          string `json:"id"`
				Title       string `json:"title"`
				PrimaryType string `json:"primary-type"`
			} `json:"release-group"`
			Date    string `json:"date"`
			Country string `json:"country"`
			Media   []struct {
				Format string `json:"format"`
			} `json:"media"`
			LabelInfo []struct {
				Label struct {
					Name string `json:"name"`
				} `json:"label"`
			} `json:"label-info"`
		} `json:"releases"`
		ArtistCredit []struct {
			Artist struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"artist"`
		} `json:"artist-credit"`
		Tags []struct {
			Count int    `json:"count"`
			Name  string `json:"name"`
		} `json:"tags"`
	} `json:"recordings"`
}

func musicBrainzCacheKey(isrc, title, artist string, useSingleGenre bool) string {
	separator := strings.TrimSpace(GetSeparator())
	if separator == "" {
		separator = ";"
	}

	if normalizedISRC := strings.ToUpper(strings.TrimSpace(isrc)); normalizedISRC != "" {
		return "isrc:" + normalizedISRC + "|" + fmt.Sprintf("%t", useSingleGenre) + "|" + separator
	}

	return "title:" + strings.ToLower(strings.TrimSpace(title)) + "|artist:" + strings.ToLower(strings.TrimSpace(artist)) + "|" + fmt.Sprintf("%t", useSingleGenre) + "|" + separator
}

func waitForMusicBrainzRequestSlot() {
	musicBrainzThrottleMu.Lock()

	readyAt := musicBrainzNextRequest
	if musicBrainzBlockedTill.After(readyAt) {
		readyAt = musicBrainzBlockedTill
	}

	now := time.Now()
	if readyAt.Before(now) {
		readyAt = now
	}

	musicBrainzNextRequest = readyAt.Add(musicBrainzMinRequestInterval)
	waitDuration := time.Until(readyAt)

	musicBrainzThrottleMu.Unlock()

	if waitDuration > 0 {
		time.Sleep(waitDuration)
	}
}

func noteMusicBrainzThrottle() {
	musicBrainzThrottleMu.Lock()
	defer musicBrainzThrottleMu.Unlock()

	cooldownUntil := time.Now().Add(musicBrainzThrottleCooldownOn503)
	if cooldownUntil.After(musicBrainzBlockedTill) {
		musicBrainzBlockedTill = cooldownUntil
	}
	if musicBrainzNextRequest.Before(musicBrainzBlockedTill) {
		musicBrainzNextRequest = musicBrainzBlockedTill
	}
}

func shouldRetryMusicBrainzRequest(err error) bool {
	if err == nil {
		return false
	}

	var statusErr *musicBrainzStatusError
	if !errors.As(err, &statusErr) {
		return true
	}

	return statusErr.StatusCode == http.StatusServiceUnavailable || statusErr.StatusCode >= http.StatusInternalServerError
}

func FetchMusicBrainzMetadata(isrc, title, artist, album string, useSingleGenre bool, embedGenre bool) (Metadata, error) {
	var meta Metadata

	if !embedGenre {
		return meta, nil
	}

	cacheKey := musicBrainzCacheKey(isrc, title, artist, useSingleGenre)
	if cached, ok := musicBrainzCache.Load(cacheKey); ok {
		return cached.(Metadata), nil
	}

	if ShouldSkipMusicBrainzMetadataFetch() {
		return meta, fmt.Errorf("skipping MusicBrainz lookup because the latest status check reported offline")
	}

	musicBrainzInflightMu.Lock()
	if call, ok := musicBrainzInflight[cacheKey]; ok {
		musicBrainzInflightMu.Unlock()
		<-call.done
		return call.result, call.err
	}

	call := &musicBrainzInflightCall{done: make(chan struct{})}
	musicBrainzInflight[cacheKey] = call
	musicBrainzInflightMu.Unlock()

	var resultErr error
	defer func() {
		call.result = meta
		call.err = resultErr

		musicBrainzInflightMu.Lock()
		delete(musicBrainzInflight, cacheKey)
		close(call.done)
		musicBrainzInflightMu.Unlock()
	}()

	client := newHTTPClient(musicBrainzRequestTimeout)

	queries := make([]string, 0, 2)
	if strings.TrimSpace(isrc) != "" {
		queries = append(queries, fmt.Sprintf("isrc:%s", strings.TrimSpace(isrc)))
	}
	titleTrimmed := strings.TrimSpace(title)
	artistTrimmed := strings.TrimSpace(artist)
	if titleTrimmed != "" && artistTrimmed != "" {
		queries = append(queries, fmt.Sprintf("recording:\"%s\" AND artist:\"%s\"", escapeMusicBrainzQuery(titleTrimmed), escapeMusicBrainzQuery(artistTrimmed)))
	} else if titleTrimmed != "" {
		queries = append(queries, fmt.Sprintf("recording:\"%s\"", escapeMusicBrainzQuery(titleTrimmed)))
	}

	if len(queries) == 0 {
		resultErr = fmt.Errorf("no query source available for genre lookup")
		return meta, resultErr
	}

	var recording *struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Length   int    `json:"length"`
		Releases []struct {
			ID           string `json:"id"`
			Title        string `json:"title"`
			Status       string `json:"status"`
			ReleaseGroup struct {
				ID          string `json:"id"`
				Title       string `json:"title"`
				PrimaryType string `json:"primary-type"`
			} `json:"release-group"`
			Date    string `json:"date"`
			Country string `json:"country"`
			Media   []struct {
				Format string `json:"format"`
			} `json:"media"`
			LabelInfo []struct {
				Label struct {
					Name string `json:"name"`
				} `json:"label"`
			} `json:"label-info"`
		} `json:"releases"`
		ArtistCredit []struct {
			Artist struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"artist"`
		} `json:"artist-credit"`
		Tags []struct {
			Count int    `json:"count"`
			Name  string `json:"name"`
		} `json:"tags"`
	}
	var lastLookupErr error

	for _, query := range queries {
		mbResp, err := queryMusicBrainzRecordings(client, query)
		if err != nil {
			lastLookupErr = err
			break
		}
		if len(mbResp.Recordings) == 0 {
			continue
		}

		bestIdx := -1
		bestTagCount := -1
		for i := range mbResp.Recordings {
			tagCount := len(mbResp.Recordings[i].Tags)
			if tagCount > bestTagCount {
				bestTagCount = tagCount
				bestIdx = i
			}
		}
		if bestIdx >= 0 {
			recording = &mbResp.Recordings[bestIdx]
			if len(recording.Tags) > 0 {
				break
			}
		}
	}

	if recording == nil {
		if lastLookupErr != nil {
			resultErr = lastLookupErr
			return meta, resultErr
		}

		resultErr = fmt.Errorf("no recordings found for provided query")
		return meta, resultErr
	}

	if lastLookupErr != nil && len(recording.Tags) == 0 {
		resultErr = lastLookupErr
		return meta, resultErr
	}

	var genres []string
	seen := make(map[string]struct{}, len(recording.Tags))

	for _, tag := range recording.Tags {
		name := strings.TrimSpace(tag.Name)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		genres = append(genres, name)
		if len(genres) >= 5 {
			break
		}
	}

	if useSingleGenre {
		if len(genres) > 0 {
			meta.Genre = genres[0]
		}
	} else if len(genres) > 0 {
		meta.Genre = strings.Join(genres, GetSeparator())
	}

	if meta.Genre == "" {
		resultErr = fmt.Errorf("no genre tags found in MusicBrainz")
		return meta, resultErr
	}

	musicBrainzCache.Store(cacheKey, meta)

	return meta, nil
}

func escapeMusicBrainzQuery(s string) string {
	return strings.ReplaceAll(s, "\"", "\\\"")
}

func queryMusicBrainzRecordings(client *http.Client, query string) (*MusicBrainzRecordingResponse, error) {
	reqURL := fmt.Sprintf("%s/recording?query=%s&fmt=json&inc=releases+artist-credits+tags+media+release-groups+labels", musicBrainzAPIBase, url.QueryEscape(query))

	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", fmt.Sprintf("SpotiDownloader/%s ( hi@afkarxyz.qzz.io )", AppVersion))
	req.Header.Set("Accept", "application/json")

	var lastErr error
	for attempt := 0; attempt < musicBrainzRequestRetries; attempt++ {
		waitForMusicBrainzRequestSlot()

		resp, err := client.Do(req)
		if err == nil && resp != nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()

			var mbResp MusicBrainzRecordingResponse
			if decodeErr := json.NewDecoder(resp.Body).Decode(&mbResp); decodeErr != nil {
				return nil, decodeErr
			}
			return &mbResp, nil
		}

		if err != nil {
			lastErr = err
		} else if resp == nil {
			lastErr = fmt.Errorf("empty response from MusicBrainz")
		} else {
			if resp.StatusCode == http.StatusServiceUnavailable {
				noteMusicBrainzThrottle()
			}
			lastErr = &musicBrainzStatusError{StatusCode: resp.StatusCode}
			resp.Body.Close()
		}

		if attempt < musicBrainzRequestRetries-1 && shouldRetryMusicBrainzRequest(lastErr) {
			time.Sleep(musicBrainzRequestRetryWait)
			continue
		}

		break
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("empty response from MusicBrainz")
	}

	return nil, lastErr
}

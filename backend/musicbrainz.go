package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var AppVersion = "Unknown"

const musicBrainzAPIBase = "https://musicbrainz.org/ws/2"

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

func FetchMusicBrainzMetadata(isrc, title, artist, album string, useSingleGenre bool, embedGenre bool) (Metadata, error) {
	var meta Metadata

	if !embedGenre {
		return meta, nil
	}

	client := newHTTPClient(10 * time.Second)

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
		return meta, fmt.Errorf("no query source available for genre lookup")
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

	for _, query := range queries {
		mbResp, err := queryMusicBrainzRecordings(client, query)
		if err != nil {
			continue
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
		return meta, fmt.Errorf("no recordings found for provided query")
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
		meta.Genre = strings.Join(genres, ", ")
	}

	if meta.Genre == "" {
		return meta, fmt.Errorf("no genre tags found in MusicBrainz")
	}

	return meta, nil
}

func escapeMusicBrainzQuery(s string) string {
	return strings.ReplaceAll(s, "\"", "\\\"")
}

func queryMusicBrainzRecordings(client *http.Client, query string) (*MusicBrainzRecordingResponse, error) {
	reqURL := fmt.Sprintf("%s/recording?query=%s&fmt=json&inc=releases+artist-credits+tags+media+release-groups+labels", musicBrainzAPIBase, url.QueryEscape(query))

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", fmt.Sprintf("SpotiDownloader/%s ( support@exyezed.cc )", AppVersion))

	var resp *http.Response
	var lastErr error
	for i := 0; i < 3; i++ {
		resp, lastErr = client.Do(req)
		if lastErr == nil && resp.StatusCode == http.StatusOK {
			break
		}

		if resp != nil {
			resp.Body.Close()
		}

		if i < 2 {
			time.Sleep(2 * time.Second)
		}
	}

	if lastErr != nil {
		return nil, lastErr
	}
	if resp == nil {
		return nil, fmt.Errorf("empty response from MusicBrainz")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("MusicBrainz API returned status: %d", resp.StatusCode)
	}

	var mbResp MusicBrainzRecordingResponse
	if err := json.NewDecoder(resp.Body).Decode(&mbResp); err != nil {
		return nil, err
	}
	return &mbResp, nil
}

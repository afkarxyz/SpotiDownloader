package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

const (
	chosicBaseURL    = "https://www.chosic.com"
	chosicToolsAPI   = chosicBaseURL + "/api/tools"
	chosicFinderPage = chosicBaseURL + "/music-genre-finder/"
)

type chosicClient struct {
	httpClient *http.Client
}

func newChosicClient() (*chosicClient, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize cookie jar: %w", err)
	}

	return &chosicClient{
		httpClient: &http.Client{
			Timeout:   20 * time.Second,
			Transport: newHTTPTransport(),
			Jar:       jar,
		},
	}, nil
}

func (c *chosicClient) handshake() error {
	if c == nil || c.httpClient == nil {
		return fmt.Errorf("chosic client is not initialized")
	}

	req, err := http.NewRequest(http.MethodPost, chosicToolsAPI+"/handshake/", nil)
	if err != nil {
		return fmt.Errorf("failed to create handshake request: %w", err)
	}
	setChosicHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("chosic handshake request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("chosic handshake failed: HTTP %d", resp.StatusCode)
	}

	var payload struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return fmt.Errorf("failed to decode chosic handshake response: %w", err)
	}
	if !payload.Success {
		return fmt.Errorf("chosic handshake returned unsuccessful response")
	}

	return nil
}

func (c *chosicClient) getTrack(trackID string) (*chosicTrackResponse, error) {
	var payload chosicTrackResponse
	if err := c.getJSON("/tracks/"+url.PathEscape(trackID), &payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

func (c *chosicClient) getArtist(artistID string) (*chosicArtistResponse, error) {
	var payload chosicArtistResponse
	if err := c.getJSON("/artists/"+url.PathEscape(artistID), &payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

func (c *chosicClient) getJSON(path string, out interface{}) error {
	if c == nil || c.httpClient == nil {
		return fmt.Errorf("chosic client is not initialized")
	}

	req, err := http.NewRequest(http.MethodGet, chosicToolsAPI+path, nil)
	if err != nil {
		return fmt.Errorf("failed to create chosic request: %w", err)
	}
	setChosicHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("chosic request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("chosic request failed: HTTP %d (%s)", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("failed to decode chosic response: %w", err)
	}
	return nil
}

func setChosicHeaders(req *http.Request) {
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Origin", chosicBaseURL)
	req.Header.Set("Referer", chosicFinderPage)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")
}

type chosicTrackResponse struct {
	Artists []struct {
		ID string `json:"id"`
	} `json:"artists"`
}

type chosicArtistResponse struct {
	Genres []string `json:"genres"`
}

func fetchGenresFromChosic(trackID string) ([]string, error) {
	trackID = strings.TrimSpace(trackID)
	if trackID == "" {
		return nil, fmt.Errorf("empty track ID")
	}

	client, err := newChosicClient()
	if err != nil {
		return nil, err
	}
	if err := client.handshake(); err != nil {
		return nil, err
	}

	track, err := client.getTrack(trackID)
	if err != nil {
		return nil, err
	}

	artistID := ""
	for _, artist := range track.Artists {
		id := strings.TrimSpace(artist.ID)
		if id != "" {
			artistID = id
			break
		}
	}
	if artistID == "" {
		return nil, fmt.Errorf("chosic track response did not contain artist ID")
	}

	artist, err := client.getArtist(artistID)
	if err != nil {
		return nil, err
	}

	genres := make([]string, 0, len(artist.Genres))
	seen := make(map[string]struct{}, len(artist.Genres))
	for _, genre := range artist.Genres {
		genre = strings.TrimSpace(genre)
		if genre != "" {
			key := strings.ToLower(genre)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			genres = append(genres, genre)
			if len(genres) >= 5 {
				break
			}
		}
	}
	if len(genres) == 0 {
		return nil, fmt.Errorf("chosic artist response did not contain genres")
	}

	return genres, nil
}

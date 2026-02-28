package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	spotidownloaderAPIBase = "https://api.spotidownloader.com"
)

type SpotiDownloader struct {
	sessionToken string
	httpClient   *http.Client
}

type FlacAvailableRequest struct {
	ID string `json:"id"`
}

type FlacAvailableResponse struct {
	Available bool `json:"available"`
}

type DownloadRequest struct {
	ID string `json:"id"`
}

type DownloadResponse struct {
	Success  bool   `json:"success"`
	Link     string `json:"link"`
	LinkFlac string `json:"linkFlac"`
}

func NewSpotiDownloader(sessionToken string) *SpotiDownloader {
	return &SpotiDownloader{
		sessionToken: sessionToken,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (s *SpotiDownloader) IsFlacAvailable(trackID string) (bool, error) {
	reqBody := FlacAvailableRequest{ID: trackID}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return false, err
	}

	req, err := http.NewRequest("POST", spotidownloaderAPIBase+"/isFlacAvailable", bytes.NewBuffer(jsonData))
	if err != nil {
		return false, err
	}

	req.Header.Set("Authorization", "Bearer "+s.sessionToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://spotidownloader.com")
	req.Header.Set("Referer", "https://spotidownloader.com/")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return false, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return false, fmt.Errorf("API returned empty response")
	}

	var result FlacAvailableResponse
	if err := json.Unmarshal(body, &result); err != nil {

		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		return false, fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
	}

	return result.Available, nil
}

func (s *SpotiDownloader) GetDownloadLink(trackID string) (*DownloadResponse, error) {
	reqBody := DownloadRequest{ID: trackID}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", spotidownloaderAPIBase+"/download", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+s.sessionToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://spotidownloader.com")
	req.Header.Set("Referer", "https://spotidownloader.com/")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return nil, fmt.Errorf("API returned empty response")
	}

	var result DownloadResponse
	if err := json.Unmarshal(body, &result); err != nil {

		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		return nil, fmt.Errorf("failed to decode API response: %w (response: %s)", err, bodyStr)
	}

	if !result.Success {
		return nil, fmt.Errorf("download request failed")
	}

	return &result, nil
}

func (s *SpotiDownloader) DownloadFile(downloadURL, outputPath string) error {
	req, err := http.NewRequest("GET", downloadURL, nil)
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+s.sessionToken)
	req.Header.Set("Referer", "https://spotidownloader.com/")
	req.Header.Set("Origin", "https://spotidownloader.com")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download file: status %d", resp.StatusCode)
	}

	dir := filepath.Dir(outputPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	out, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer out.Close()

	progressWriter := NewProgressWriter(out)

	_, err = io.Copy(progressWriter, resp.Body)

	if err == nil {
		mbDownloaded := float64(progressWriter.GetTotal()) / (1024 * 1024)
		fmt.Printf("\rDownloaded: %.2f MB - Complete\n", mbDownloaded)
	}

	return err
}

func (s *SpotiDownloader) DownloadTrack(
	trackID string,
	outputDir string,
	audioFormat string,
	filenameFormat string,
	includeTrackNumber bool,
	position int,
	trackName string,
	artistName string,
	albumName string,
	albumArtist string,
	releaseDate string,
	coverURL string,
	actualTrackNumber int,
	discNumber int,
	totalTracks int,
	useAlbumTrackNumber bool,
	embedMaxQualityCover bool,
	totalDiscs int,
	copyright string,
	publisher string,
	playlistName string,
	playlistOwner string,
	useFirstArtistOnly bool,
	useSingleGenre bool,
	embedGenre bool,
) (string, error) {

	outputDir = NormalizePath(outputDir)

	downloadResp, err := s.GetDownloadLink(trackID)
	if err != nil {
		return "", fmt.Errorf("failed to get download link: %v", err)
	}

	var downloadURL string
	var fileExt string

	if audioFormat == "flac" && downloadResp.LinkFlac != "" {
		downloadURL = downloadResp.LinkFlac
		fileExt = ".flac"
	} else {
		downloadURL = downloadResp.Link
		fileExt = ".mp3"
	}

	if downloadURL == "" {
		return "", fmt.Errorf("no download link available")
	}

	filenameArtist := artistName
	filenameAlbumArtist := albumArtist
	if useFirstArtistOnly {
		filenameArtist = GetFirstArtist(artistName)
		filenameAlbumArtist = GetFirstArtist(albumArtist)
	}

	filename := BuildFilename(trackName, filenameArtist, albumName, filenameAlbumArtist, releaseDate, discNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber, playlistName, playlistOwner)
	filename = SanitizeFilename(filename) + fileExt

	outputPath := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(outputPath); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputPath, float64(fileInfo.Size())/(1024*1024))
		return "EXISTS:" + outputPath, nil
	}

	type mbResult struct {
		ISRC     string
		Metadata Metadata
	}

	metaChan := make(chan mbResult, 1)
	if embedGenre {
		go func() {
			client := NewSongLinkClient()
			res := mbResult{}
			if val, err := client.GetISRC(trackID); err == nil {
				res.ISRC = val
				if val != "" {
					fmt.Println("Fetching MusicBrainz metadata...")

					if fetchedMeta, err := FetchMusicBrainzMetadata(val, trackName, artistName, albumName, useSingleGenre, embedGenre); err == nil {
						res.Metadata = fetchedMeta
						fmt.Println("✓ MusicBrainz metadata fetched")
					} else {
						fmt.Printf("Warning: Failed to fetch MusicBrainz metadata: %v\n", err)
					}
				}
			} else {

			}
			metaChan <- res
		}()
	} else {
		metaChan <- mbResult{}
	}

	if err := s.DownloadFile(downloadURL, outputPath); err != nil {
		return "", fmt.Errorf("failed to download file: %v", err)
	}

	var coverPath string
	if coverURL != "" {
		coverPath, err = s.downloadCoverImage(coverURL, outputDir, embedMaxQualityCover)
		if err != nil {
			fmt.Printf("Warning: Failed to download cover image: %v\n", err)
			coverPath = ""
		}
	}

	result := <-metaChan
	isrc := result.ISRC
	mbMeta := result.Metadata
	resolvedReleaseDate := strings.TrimSpace(releaseDate)
	resolvedGenre := strings.TrimSpace(mbMeta.Genre)

	if resolvedReleaseDate == "" || (embedGenre && resolvedGenre == "") {
		spotifyReleaseDate, spotifyGenre := fetchTrackTaggingMetadata(trackID)
		if resolvedReleaseDate == "" && spotifyReleaseDate != "" {
			resolvedReleaseDate = spotifyReleaseDate
		}
		if embedGenre && resolvedGenre == "" && spotifyGenre != "" {
			resolvedGenre = spotifyGenre
		}
	}
	if embedGenre && resolvedGenre == "" {
		if deezerGenre, err := fetchGenreFromDeezer(trackID); err == nil && deezerGenre != "" {
			resolvedGenre = deezerGenre
		}
	}

	if isrc != "" {
		fmt.Printf("Found ISRC: %s\n", isrc)
	}

	metadata := Metadata{
		Title:       trackName,
		Artist:      artistName,
		Album:       albumName,
		AlbumArtist: albumArtist,
		Date:        resolvedReleaseDate,
		TrackNumber: actualTrackNumber,
		TotalTracks: totalTracks,
		DiscNumber:  discNumber,
		TotalDiscs:  totalDiscs,
		URL:         fmt.Sprintf("https://open.spotify.com/track/%s", trackID),
		Copyright:   copyright,
		Publisher:   publisher,
		Description: "https://github.com/afkarxyz/SpotiDownloader",
		ISRC:        isrc,
		Genre:       resolvedGenre,
	}

	if err := EmbedMetadata(outputPath, metadata, coverPath); err != nil {
		fmt.Printf("Warning: Failed to embed metadata: %v\n", err)
	}

	if coverPath != "" {
		os.Remove(coverPath)
	}

	return outputPath, nil
}

func (s *SpotiDownloader) downloadCoverImage(coverURL, outputDir string, embedMaxQualityCover bool) (string, error) {

	coverURL = convertSmallToMedium(coverURL)

	if embedMaxQualityCover {
		coverClient := NewCoverClient()
		coverURL = coverClient.getMaxResolutionURL(coverURL)
	}

	resp, err := s.httpClient.Get(coverURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download cover: status %d", resp.StatusCode)
	}

	coverPath := filepath.Join(outputDir, ".temp_cover.jpg")
	out, err := os.Create(coverPath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return "", err
	}

	return coverPath, nil
}

func fetchTrackTaggingMetadata(trackID string) (string, string) {
	if strings.TrimSpace(trackID) == "" {
		return "", ""
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	client := NewSpotifyMetadataClient()
	data, err := client.GetFilteredData(ctx, fmt.Sprintf("https://open.spotify.com/track/%s", trackID), false, 0)
	if err != nil {
		return "", ""
	}

	switch resp := data.(type) {
	case TrackResponse:
		return strings.TrimSpace(resp.Track.ReleaseDate), strings.TrimSpace(resp.Track.Genre)
	case *TrackResponse:
		if resp != nil {
			return strings.TrimSpace(resp.Track.ReleaseDate), strings.TrimSpace(resp.Track.Genre)
		}
	}

	return "", ""
}

func fetchGenreFromDeezer(trackID string) (string, error) {
	if strings.TrimSpace(trackID) == "" {
		return "", fmt.Errorf("empty track ID")
	}
	client := NewSongLinkClient()
	genre, err := client.GetGenre(trackID)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(genre), nil
}

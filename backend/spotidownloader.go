package backend

import (
	"bytes"
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

	var result FlacAvailableResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, err
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

	var result DownloadResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
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

	// Create output directory if it doesn't exist
	dir := filepath.Dir(outputPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	// Create the file
	out, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer out.Close()

	// Use ProgressWriter to track download progress
	progressWriter := NewProgressWriter(out)

	// Write the body to file with progress tracking
	_, err = io.Copy(progressWriter, resp.Body)

	// Print final progress
	if err == nil {
		mbDownloaded := float64(progressWriter.GetTotal()) / (1024 * 1024)
		fmt.Printf("\rDownloaded: %.2f MB - Complete\n", mbDownloaded)
	}

	return err
}

func (s *SpotiDownloader) DownloadByISRC(
	trackID string,
	isrc string,
	outputDir string,
	audioFormat string,
	filenameFormat string,
	includeTrackNumber bool,
	position int,
	trackName string,
	artistName string,
	albumName string,
	releaseDate string,
	coverURL string,
	actualTrackNumber int,
	useAlbumTrackNumber bool,
) (string, error) {
	// Get download links
	downloadResp, err := s.GetDownloadLink(trackID)
	if err != nil {
		return "", fmt.Errorf("failed to get download link: %v", err)
	}

	// Select the appropriate download link based on format
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

	// Build filename
	// Check if file with same ISRC already exists
	if isrc != "" {
		if existingFile, exists := CheckISRCExists(outputDir, isrc, audioFormat); exists {
			fmt.Printf("File with ISRC %s already exists: %s\n", isrc, existingFile)
			return "EXISTS:" + existingFile, nil
		}
	}

	filename := BuildFilename(trackName, artistName, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
	filename = SanitizeFilename(filename) + fileExt

	outputPath := filepath.Join(outputDir, filename)

	// Check if file already exists by filename
	if fileInfo, err := os.Stat(outputPath); err == nil && fileInfo.Size() > 0 {
		return "EXISTS:" + outputPath, nil
	}

	// Download the file
	if err := s.DownloadFile(downloadURL, outputPath); err != nil {
		return "", fmt.Errorf("failed to download file: %v", err)
	}

	// Download cover image if provided
	var coverPath string
	if coverURL != "" {
		coverPath, err = s.downloadCoverImage(coverURL, outputDir)
		if err != nil {
			fmt.Printf("Warning: Failed to download cover image: %v\n", err)
			coverPath = "" // Continue without cover
		}
	}

	// Embed metadata for both MP3 and FLAC
	metadata := Metadata{
		Title:       trackName,
		Artist:      artistName,
		Album:       albumName,
		Date:        releaseDate,
		TrackNumber: actualTrackNumber,
		ISRC:        isrc,
	}

	if err := EmbedMetadata(outputPath, metadata, coverPath); err != nil {
		fmt.Printf("Warning: Failed to embed metadata: %v\n", err)
	}

	// Clean up cover image file after embedding
	if coverPath != "" {
		os.Remove(coverPath)
	}

	return outputPath, nil
}

// downloadCoverImage downloads the cover image from URL
func (s *SpotiDownloader) downloadCoverImage(coverURL, outputDir string) (string, error) {
	resp, err := s.httpClient.Get(coverURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download cover: status %d", resp.StatusCode)
	}

	// Create temp file for cover
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

// Helper function to sanitize filename
func SanitizeFilename(filename string) string {
	// Remove or replace invalid characters
	invalid := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	result := filename
	for _, char := range invalid {
		result = strings.ReplaceAll(result, char, "_")
	}
	return result
}

// Helper function to build filename
func BuildFilename(trackName, artistName, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
	var filename string

	switch format {
	case "artist-title":
		filename = fmt.Sprintf("%s - %s", artistName, trackName)
	case "title":
		filename = trackName
	default: // "title-artist"
		filename = fmt.Sprintf("%s - %s", trackName, artistName)
	}

	if includeTrackNumber && position > 0 {
		filename = fmt.Sprintf("%02d. %s", position, filename)
	}

	return filename
}

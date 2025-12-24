package backend

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
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

	// Read body first to handle encoding issues
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return false, fmt.Errorf("API returned empty response")
	}

	var result FlacAvailableResponse
	if err := json.Unmarshal(body, &result); err != nil {
		// Truncate body for error message (max 200 chars)
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

	// Read body first to handle encoding issues and provide better error messages
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return nil, fmt.Errorf("API returned empty response")
	}

	var result DownloadResponse
	if err := json.Unmarshal(body, &result); err != nil {
		// Truncate body for error message (max 200 chars)
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
	albumArtist string,
	releaseDate string,
	coverURL string,
	actualTrackNumber int,
	discNumber int,
	totalTracks int,
	useAlbumTrackNumber bool,
	embedMaxQualityCover bool,
) (string, error) {
	// Only normalize path separators for user's download path
	outputDir = NormalizePath(outputDir)

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

	filename := BuildFilename(trackName, artistName, albumName, albumArtist, releaseDate, discNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
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
		coverPath, err = s.downloadCoverImage(coverURL, outputDir, embedMaxQualityCover)
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
		AlbumArtist: albumArtist,
		Date:        releaseDate, // Recorded date (full date YYYY-MM-DD)
		TrackNumber: actualTrackNumber,
		TotalTracks: totalTracks, // Total tracks in album from Spotify
		DiscNumber:  discNumber,
		ISRC:        isrc,
		Description: "https://github.com/afkarxyz/SpotiDownloader",
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
func (s *SpotiDownloader) downloadCoverImage(coverURL, outputDir string, embedMaxQualityCover bool) (string, error) {
	// Use max quality URL if setting is enabled
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
	// Replace forward slash with space (more natural than underscore)
	result := strings.ReplaceAll(filename, "/", " ")

	// Remove other invalid filesystem characters (replace with space)
	invalid := []string{"\\", ":", "*", "?", "\"", "<", ">", "|"}
	for _, char := range invalid {
		result = strings.ReplaceAll(result, char, " ")
	}

	// Remove control characters and emoji
	var sanitized strings.Builder
	for _, r := range result {
		// Keep printable characters and valid Unicode characters
		// Remove control characters, but keep spaces, tabs, newlines for now
		if r < 0x20 && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}
		if r == 0x7F {
			continue
		}
		// Remove emoji ranges (most emoji are in these ranges)
		if (r >= 0x1F300 && r <= 0x1F9FF) || // Miscellaneous Symbols and Pictographs, Emoticons
			(r >= 0x2600 && r <= 0x26FF) || // Miscellaneous Symbols
			(r >= 0x2700 && r <= 0x27BF) || // Dingbats
			(r >= 0xFE00 && r <= 0xFE0F) || // Variation Selectors
			(r >= 0x1F900 && r <= 0x1F9FF) || // Supplemental Symbols and Pictographs
			(r >= 0x1F600 && r <= 0x1F64F) || // Emoticons
			(r >= 0x1F680 && r <= 0x1F6FF) || // Transport and Map Symbols
			(r >= 0x1F1E0 && r <= 0x1F1FF) { // Regional Indicator Symbols (flags)
			continue
		}
		sanitized.WriteRune(r)
	}

	result = sanitized.String()
	result = strings.TrimSpace(result)

	// Remove leading/trailing dots and spaces (Windows doesn't allow these)
	result = strings.Trim(result, ". ")

	// Normalize consecutive spaces to single space
	re := regexp.MustCompile(`\s+`)
	result = re.ReplaceAllString(result, " ")

	// Normalize consecutive underscores to single underscore
	re = regexp.MustCompile(`_+`)
	result = re.ReplaceAllString(result, "_")

	// Remove leading/trailing underscores and spaces
	result = strings.Trim(result, "_ ")

	if result == "" {
		return "Unknown"
	}

	return result
}

// NormalizePath only normalizes path separators without modifying folder names
// Use this for user-provided paths that already exist on the filesystem
func NormalizePath(folderPath string) string {
	// Normalize all forward slashes to backslashes on Windows
	return strings.ReplaceAll(folderPath, "/", string(filepath.Separator))
}

// SanitizeFolderPath sanitizes each component of a folder path and normalizes separators
// Use this only for NEW folders being created (artist names, album names, etc.)
func SanitizeFolderPath(folderPath string) string {
	// Normalize all forward slashes to backslashes on Windows
	normalizedPath := strings.ReplaceAll(folderPath, "/", string(filepath.Separator))

	// Detect separator
	sep := string(filepath.Separator)

	// Split path into components
	parts := strings.Split(normalizedPath, sep)
	sanitizedParts := make([]string, 0, len(parts))

	for i, part := range parts {
		// Keep drive letter intact on Windows (e.g., "C:")
		if i == 0 && len(part) == 2 && part[1] == ':' {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}

		// Keep empty first part for absolute paths on Unix (e.g., "/Users/...")
		if i == 0 && part == "" {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}

		// Sanitize each folder name (but don't replace / or \ since we already normalized)
		sanitized := sanitizeFolderName(part)
		if sanitized != "" {
			sanitizedParts = append(sanitizedParts, sanitized)
		}
	}

	return strings.Join(sanitizedParts, sep)
}

// sanitizeFolderName removes invalid characters from a single folder name
func sanitizeFolderName(name string) string {
	// Use the same sanitization as filename
	return SanitizeFilename(name)
}

// Helper function to build filename
func BuildFilename(trackName, artistName, albumName, albumArtist, releaseDate string, discNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
	safeTitle := SanitizeFilename(trackName)
	safeArtist := SanitizeFilename(artistName)
	safeAlbum := SanitizeFilename(albumName)
	safeAlbumArtist := SanitizeFilename(albumArtist)

	// Extract year from release date (format: YYYY-MM-DD or YYYY)
	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	var filename string

	// Check if format is a template (contains {})
	if strings.Contains(format, "{") {
		filename = format
		filename = strings.ReplaceAll(filename, "{title}", safeTitle)
		filename = strings.ReplaceAll(filename, "{artist}", safeArtist)
		filename = strings.ReplaceAll(filename, "{album}", safeAlbum)
		filename = strings.ReplaceAll(filename, "{album_artist}", safeAlbumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)

		// Handle disc number
		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		// Handle track number - if position is 0, remove {track} and surrounding separators
		if position > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", position))
		} else {
			// Remove {track} with common separators like ". " or " - " or ". "
			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
		return filename
	}

	// Legacy format support
	switch format {
	case "artist-title":
		filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
	case "title":
		filename = safeTitle
	default: // "title-artist"
		filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
	}

	// Add track number prefix if enabled (legacy behavior)
	if includeTrackNumber && position > 0 {
		filename = fmt.Sprintf("%02d. %s", position, filename)
	}

	return filename
}

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"spotidownloader/backend"
	"strings"
	"time"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// SpotifyMetadataRequest represents the request structure for fetching Spotify metadata
type SpotifyMetadataRequest struct {
	URL     string  `json:"url"`
	Batch   bool    `json:"batch"`
	Delay   float64 `json:"delay"`
	Timeout float64 `json:"timeout"`
}

// DownloadRequest represents the request structure for downloading tracks
type DownloadRequest struct {
	ISRC                string `json:"isrc"`
	TrackID             string `json:"track_id,omitempty"`
	SessionToken        string `json:"session_token"`
	TrackName           string `json:"track_name,omitempty"`
	ArtistName          string `json:"artist_name,omitempty"`
	AlbumName           string `json:"album_name,omitempty"`
	ReleaseDate         string `json:"release_date,omitempty"`
	CoverURL            string `json:"cover_url,omitempty"`
	AlbumTrackNumber    int    `json:"album_track_number,omitempty"`
	OutputDir           string `json:"output_dir,omitempty"`
	AudioFormat         string `json:"audio_format,omitempty"`
	FilenameFormat      string `json:"filename_format,omitempty"`
	TrackNumber         bool   `json:"track_number,omitempty"`
	Position            int    `json:"position,omitempty"`               // Position in playlist/album (1-based)
	UseAlbumTrackNumber bool   `json:"use_album_track_number,omitempty"` // Use album track number instead of playlist position
}

// DownloadResponse represents the response structure for download operations
type DownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

// GetSpotifyMetadata fetches metadata from Spotify
func (a *App) GetSpotifyMetadata(req SpotifyMetadataRequest) (string, error) {
	if req.URL == "" {
		return "", fmt.Errorf("URL parameter is required")
	}

	if req.Delay == 0 {
		req.Delay = 1.0
	}
	if req.Timeout == 0 {
		req.Timeout = 300.0
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(req.Timeout*float64(time.Second)))
	defer cancel()

	data, err := backend.GetFilteredSpotifyData(ctx, req.URL, req.Batch, time.Duration(req.Delay*float64(time.Second)))
	if err != nil {
		return "", fmt.Errorf("failed to fetch metadata: %v", err)
	}

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

// DownloadTrack downloads a track using spotidownloader API
func (a *App) DownloadTrack(req DownloadRequest) (DownloadResponse, error) {
	if req.TrackID == "" && req.ISRC == "" {
		return DownloadResponse{
			Success: false,
			Error:   "track ID or ISRC is required",
		}, fmt.Errorf("track ID or ISRC is required")
	}

	if req.SessionToken == "" {
		return DownloadResponse{
			Success: false,
			Error:   "session token is required",
		}, fmt.Errorf("session token is required")
	}

	if req.OutputDir == "" {
		req.OutputDir = "."
	}

	if req.AudioFormat == "" {
		req.AudioFormat = "mp3"
	}

	// Set default filename format if not provided
	if req.FilenameFormat == "" {
		req.FilenameFormat = "title-artist"
	}

	// Early check: if we have track metadata, check if file already exists
	if req.TrackName != "" && req.ArtistName != "" {
		fileExt := ".mp3"
		if req.AudioFormat == "flac" {
			fileExt = ".flac"
		}
		expectedFilename := backend.BuildFilename(req.TrackName, req.ArtistName, req.FilenameFormat, req.TrackNumber, req.Position, req.UseAlbumTrackNumber)
		expectedFilename = backend.SanitizeFilename(expectedFilename) + fileExt
		expectedPath := filepath.Join(req.OutputDir, expectedFilename)

		if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 0 {
			return DownloadResponse{
				Success:       true,
				Message:       "File already exists",
				File:          expectedPath,
				AlreadyExists: true,
			}, nil
		}
	}

	// Set downloading state
	backend.SetDownloading(true)
	defer backend.SetDownloading(false)

	// Use TrackID if provided, otherwise use ISRC
	trackID := req.TrackID
	if trackID == "" {
		trackID = req.ISRC
	}

	downloader := backend.NewSpotiDownloader(req.SessionToken)

	// Determine actual track number to use
	actualTrackNumber := req.Position
	if req.UseAlbumTrackNumber && req.AlbumTrackNumber > 0 {
		actualTrackNumber = req.AlbumTrackNumber
	}

	filename, err := downloader.DownloadByISRC(
		trackID,
		req.ISRC,
		req.OutputDir,
		req.AudioFormat,
		req.FilenameFormat,
		req.TrackNumber,
		req.Position,
		req.TrackName,
		req.ArtistName,
		req.AlbumName,
		req.ReleaseDate,
		req.CoverURL,
		actualTrackNumber,
		req.UseAlbumTrackNumber,
	)

	if err != nil {
		return DownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("Download failed: %v", err),
		}, err
	}

	// Check if file already existed
	alreadyExists := false
	if strings.HasPrefix(filename, "EXISTS:") {
		alreadyExists = true
		filename = strings.TrimPrefix(filename, "EXISTS:")
	}

	message := "Download completed successfully"
	if alreadyExists {
		message = "File already exists"
	}

	return DownloadResponse{
		Success:       true,
		Message:       message,
		File:          filename,
		AlreadyExists: alreadyExists,
	}, nil
}

// OpenFolder opens a folder in the file explorer
func (a *App) OpenFolder(path string) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}

	err := backend.OpenFolderInExplorer(path)
	if err != nil {
		return fmt.Errorf("failed to open folder: %v", err)
	}

	return nil
}

// SelectFolder opens a folder selection dialog and returns the selected path
func (a *App) SelectFolder(defaultPath string) (string, error) {
	return backend.SelectFolderDialog(a.ctx, defaultPath)
}

// GetDefaults returns the default configuration
func (a *App) GetDefaults() map[string]string {
	return map[string]string{
		"downloadPath": backend.GetDefaultMusicPath(),
	}
}

// GetDownloadProgress returns current download progress
func (a *App) GetDownloadProgress() backend.ProgressInfo {
	return backend.GetDownloadProgress()
}

// TokenResponse represents the response with token and expiry time
type TokenResponse struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"` // Unix timestamp
}

// FetchSessionToken fetches session token by running gettoken.exe
func (a *App) FetchSessionToken() (TokenResponse, error) {
	token, err := backend.FetchSessionToken()
	if err != nil {
		return TokenResponse{}, fmt.Errorf("failed to fetch session token: %v", err)
	}

	// Token expires in 3 minutes (180 seconds)
	expiresAt := time.Now().Add(3 * time.Minute).Unix()

	return TokenResponse{
		Token:     token,
		ExpiresAt: expiresAt,
	}, nil
}

// Quit closes the application
func (a *App) Quit() {
	// You can add cleanup logic here if needed
	panic("quit") // This will trigger Wails to close the app
}

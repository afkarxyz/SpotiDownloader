package backend

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// getSpotiDownloaderDir returns the path to ~/.spotidownloader directory
func getSpotiDownloaderDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user home directory: %v", err)
	}
	return filepath.Join(homeDir, ".spotidownloader"), nil
}

// FetchSessionToken menjalankan get_token dan mengembalikan session token
func FetchSessionToken() (string, error) {
	return FetchSessionTokenWithParams(5, 1)
}

// FetchSessionTokenWithParams menjalankan get_token dengan parameter timeout dan retry
func FetchSessionTokenWithParams(timeout int, retry int) (string, error) {
	// Get the .spotidownloader directory path
	spotiDir, err := getSpotiDownloaderDir()
	if err != nil {
		return "", err
	}

	// Create directory if it doesn't exist
	if err := os.MkdirAll(spotiDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create .spotidownloader directory: %v", err)
	}

	// Get the appropriate binary for current OS (defined in platform-specific files)
	binaryData, binaryName := getTokenBinary()
	exePath := filepath.Join(spotiDir, binaryName)

	// Check if binary already exists and has the same size
	needsUpdate := true
	if info, err := os.Stat(exePath); err == nil {
		if info.Size() == int64(len(binaryData)) {
			needsUpdate = false
		}
	}

	// Write binary if needed
	if needsUpdate {
		err = os.WriteFile(exePath, binaryData, 0755)
		if err != nil {
			return "", fmt.Errorf("failed to write get_token binary: %v", err)
		}
	}

	// Jalankan executable dengan parameter timeout dan retry
	cmd := exec.Command(exePath, "--timeout", fmt.Sprintf("%d", timeout), "--retry", fmt.Sprintf("%d", retry))
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to execute get_token: %v, output: %s", err, string(output))
	}

	// Ambil output dan bersihkan whitespace
	token := strings.TrimSpace(string(output))

	// Validasi token (harus dimulai dengan eyJ untuk JWT)
	if token == "" || !strings.HasPrefix(token, "eyJ") {
		return "", fmt.Errorf("get_token did not return a valid token: %s", token)
	}

	return token, nil
}

package backend

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Embed binaries untuk berbagai platform
//go:embed bin/gettoken-windows-amd64.exe
var gettokenWindowsAmd64 []byte

//go:embed bin/gettoken-darwin-universal
var gettokenDarwinUniversal []byte

//go:embed bin/gettoken-linux-amd64
var gettokenLinuxAmd64 []byte

// getEmbeddedBinary mengembalikan binary data dan nama file yang sesuai dengan platform
func getEmbeddedBinary() ([]byte, string, error) {
	switch runtime.GOOS {
	case "windows":
		return gettokenWindowsAmd64, "gettoken.exe", nil
	case "darwin":
		return gettokenDarwinUniversal, "gettoken", nil
	case "linux":
		return gettokenLinuxAmd64, "gettoken", nil
	default:
		return nil, "", fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
}

// FetchSessionToken menjalankan gettoken binary dan mengembalikan session token
func FetchSessionToken() (string, error) {
	// Dapatkan binary yang sesuai dengan platform
	binaryData, binaryName, err := getEmbeddedBinary()
	if err != nil {
		return "", err
	}

	// Buat temporary file untuk binary
	tempDir := os.TempDir()
	exePath := filepath.Join(tempDir, binaryName)

	// Tulis embedded binary ke temporary file
	err = os.WriteFile(exePath, binaryData, 0755)
	if err != nil {
		return "", fmt.Errorf("failed to write %s: %v", binaryName, err)
	}
	defer os.Remove(exePath) // Hapus setelah selesai

	// Jalankan executable
	cmd := exec.Command(exePath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to execute %s: %v, output: %s", binaryName, err, string(output))
	}

	// Ambil output dan bersihkan whitespace
	fullOutput := strings.TrimSpace(string(output))

	// Split berdasarkan baris dan ambil hanya token (bukan "Bypass successful.")
	lines := strings.Split(fullOutput, "\n")
	var token string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		// Skip baris "Bypass successful." dan baris kosong
		if line != "" && !strings.Contains(line, "Bypass successful") {
			// Cek apakah ini JWT token (dimulai dengan eyJ)
			if strings.HasPrefix(line, "eyJ") {
				token = line
				break
			}
		}
	}

	if token == "" {
		return "", fmt.Errorf("%s did not return a valid token", binaryName)
	}

	return token, nil
}

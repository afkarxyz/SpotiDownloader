package backend

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

//go:embed bin/get_token.exe
var gettokenExe []byte

// FetchSessionToken menjalankan get_token.exe dan mengembalikan session token
func FetchSessionToken() (string, error) {
	// Buat temporary file untuk get_token.exe
	tempDir := os.TempDir()
	exePath := filepath.Join(tempDir, "get_token.exe")

	// Tulis embedded exe ke temporary file
	err := os.WriteFile(exePath, gettokenExe, 0755)
	if err != nil {
		return "", fmt.Errorf("failed to write get_token.exe: %v", err)
	}
	defer os.Remove(exePath) // Hapus setelah selesai

	// Jalankan executable
	cmd := exec.Command(exePath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to execute get_token.exe: %v, output: %s", err, string(output))
	}

	// Ambil output dan bersihkan whitespace
	token := strings.TrimSpace(string(output))

	// Validasi token (harus dimulai dengan eyJ untuk JWT)
	if token == "" || !strings.HasPrefix(token, "eyJ") {
		return "", fmt.Errorf("get_token.exe did not return a valid token: %s", token)
	}

	return token, nil
}

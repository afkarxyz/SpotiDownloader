package backend

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func IsChromeInstalled() (bool, string, error) {
	switch runtime.GOOS {
	case "windows":
		return isChromeInstalledWindows()
	case "darwin":
		return isChromeInstalledMacOS()
	case "linux":
		return isChromeInstalledLinux()
	default:
		return false, "", fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
}

func isChromeInstalledWindows() (bool, string, error) {
	chromePaths := []string{
		`C:\Program Files\Google\Chrome\Application\chrome.exe`,
		`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("PROGRAMFILES"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("PROGRAMFILES(X86)"), "Google", "Chrome", "Application", "chrome.exe"),
	}

	if path := findFirstExistingPath(chromePaths); path != "" {
		return true, path, nil
	}

	if path := findWithWhere("chrome.exe"); path != "" {
		return true, path, nil
	}

	edgePaths := []string{
		`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
		`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("PROGRAMFILES"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("PROGRAMFILES(X86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
	}

	if path := findFirstExistingPath(edgePaths); path != "" {
		return true, path, nil
	}

	if path := findWithWhere("msedge.exe"); path != "" {
		return true, path, nil
	}

	return false, "", nil
}

func findFirstExistingPath(paths []string) string {
	for _, path := range paths {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return ""
}

func findWithWhere(binaryName string) string {
	cmd := exec.Command("where", binaryName)
	output, err := cmd.Output()
	if err != nil {
		return ""
	}

	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		candidate := strings.TrimSpace(line)
		if candidate == "" || strings.Contains(candidate, "INFO:") {
			continue
		}
		return candidate
	}
	return ""
}

func isChromeInstalledMacOS() (bool, string, error) {
	chromePath := "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	if _, err := os.Stat(chromePath); err == nil {
		return true, chromePath, nil
	}

	cmd := exec.Command("which", "google-chrome")
	output, err := cmd.Output()
	if err == nil {
		path := strings.TrimSpace(string(output))
		if path != "" {
			return true, path, nil
		}
	}

	return false, "", nil
}

func isChromeInstalledLinux() (bool, string, error) {

	commands := []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser"}

	for _, cmdName := range commands {
		cmd := exec.Command("which", cmdName)
		output, err := cmd.Output()
		if err == nil {
			path := strings.TrimSpace(string(output))
			if path != "" {
				return true, path, nil
			}
		}
	}

	return false, "", nil
}

func GetChromeInstallationMessage() string {
	switch runtime.GOOS {
	case "windows":
		return "Chrome or Microsoft Edge is required but not found. Please install Google Chrome from https://www.google.com/chrome/ or Microsoft Edge from https://www.microsoft.com/edge/\n\nChromeDriver will be automatically managed."
	case "darwin":
		return "ChromeDriver is required for token fetching. Please install:\n\nbrew install --cask chromedriver\n\nAfter installation, you may need to allow ChromeDriver in System Preferences > Security & Privacy."
	case "linux":
		return "Chrome or Chromium is required but not found. Please install:\n\nUbuntu/Debian:\nsudo apt install chromium-browser chromium-chromedriver\n\nArch Linux:\nsudo pacman -S chromium\n\nFedora:\nsudo dnf install chromium chromedriver"
	default:
		return "Chrome browser is required but not found. Please install Google Chrome from https://www.google.com/chrome/"
	}
}

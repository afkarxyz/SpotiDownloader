//go:build windows

package backend

import (
	_ "embed"
	"os/exec"
	"syscall"
)

//go:embed bin/get_token.exe
var gettokenBinary []byte

func getTokenBinary() ([]byte, string) {
	return gettokenBinary, "get_token.exe"
}

func newTokenCmd(exePath string, args ...string) *exec.Cmd {
	cmd := exec.Command(exePath, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

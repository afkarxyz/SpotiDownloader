//go:build linux || darwin

package backend

import (
	_ "embed"
	"os/exec"
)

//go:embed bin/get_token
var gettokenBinary []byte

func getTokenBinary() ([]byte, string) {
	return gettokenBinary, "get_token"
}

func newTokenCmd(exePath string, args ...string) *exec.Cmd {
	return exec.Command(exePath, args...)
}

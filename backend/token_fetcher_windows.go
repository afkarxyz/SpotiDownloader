//go:build windows

package backend

import _ "embed"

//go:embed bin/get_token.exe
var gettokenBinary []byte

func getTokenBinary() ([]byte, string) {
	return gettokenBinary, "get_token.exe"
}

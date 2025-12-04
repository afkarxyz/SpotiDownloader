//go:build linux || darwin

package backend

import _ "embed"

//go:embed bin/get_token
var gettokenBinary []byte

func getTokenBinary() ([]byte, string) {
	return gettokenBinary, "get_token"
}

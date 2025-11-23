//go:build windows

package backend

import (
	_ "embed"
)

//go:embed bin/gettoken-windows-amd64.exe
var embeddedBinary []byte

const binaryName = "gettoken.exe"

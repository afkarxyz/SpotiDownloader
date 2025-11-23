//go:build linux

package backend

import (
	_ "embed"
)

//go:embed bin/gettoken-linux-amd64
var embeddedBinary []byte

const binaryName = "gettoken"

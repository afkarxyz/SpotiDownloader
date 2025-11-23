//go:build darwin

package backend

import (
	_ "embed"
)

//go:embed bin/gettoken-darwin-universal
var embeddedBinary []byte

const binaryName = "gettoken"

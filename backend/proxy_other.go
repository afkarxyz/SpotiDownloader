//go:build !windows

package backend

import (
	"net/http"
	"net/url"
)

func systemProxyFromOS(_ *http.Request) (*url.URL, error) {
	return nil, nil
}

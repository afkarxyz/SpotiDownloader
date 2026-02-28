package backend

import (
	"net"
	"net/http"
	"net/url"
	"time"
)

func newHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: newHTTPTransport(),
	}
}

func newHTTPTransport() *http.Transport {
	return &http.Transport{
		Proxy:                 proxyFromEnvironmentOrSystem,
		DialContext:           (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
}

func proxyFromEnvironmentOrSystem(req *http.Request) (*url.URL, error) {
	proxyURL, err := http.ProxyFromEnvironment(req)
	if proxyURL != nil || err != nil {
		return proxyURL, err
	}
	return systemProxyFromOS(req)
}

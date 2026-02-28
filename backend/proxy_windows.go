//go:build windows

package backend

import (
	"net/http"
	"net/url"
	"path"
	"strings"

	"golang.org/x/sys/windows/registry"
)

type windowsProxySettings struct {
	Enabled  bool
	Server   string
	Override string
}

func systemProxyFromOS(req *http.Request) (*url.URL, error) {
	if req == nil || req.URL == nil {
		return nil, nil
	}

	settings, err := readWindowsProxySettings()
	if err != nil || !settings.Enabled || strings.TrimSpace(settings.Server) == "" {
		return nil, nil
	}

	host := strings.ToLower(strings.TrimSpace(req.URL.Hostname()))
	if shouldBypassWindowsProxy(host, settings.Override) {
		return nil, nil
	}

	proxySpec := pickWindowsProxyServer(settings.Server, strings.ToLower(req.URL.Scheme))
	if proxySpec == "" {
		return nil, nil
	}

	return normalizeProxyURL(proxySpec)
}

func readWindowsProxySettings() (windowsProxySettings, error) {
	key, err := registry.OpenKey(
		registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
		registry.QUERY_VALUE,
	)
	if err != nil {
		return windowsProxySettings{}, err
	}
	defer key.Close()

	proxyEnable, _, _ := key.GetIntegerValue("ProxyEnable")
	proxyServer, _, _ := key.GetStringValue("ProxyServer")
	proxyOverride, _, _ := key.GetStringValue("ProxyOverride")

	return windowsProxySettings{
		Enabled:  proxyEnable != 0,
		Server:   strings.TrimSpace(proxyServer),
		Override: strings.TrimSpace(proxyOverride),
	}, nil
}

func shouldBypassWindowsProxy(host string, overrideList string) bool {
	if host == "" || strings.TrimSpace(overrideList) == "" {
		return false
	}

	rules := strings.FieldsFunc(overrideList, func(r rune) bool {
		return r == ';' || r == ','
	})

	for _, rule := range rules {
		rule = strings.ToLower(strings.TrimSpace(rule))
		if rule == "" {
			continue
		}

		if rule == "<local>" && !strings.Contains(host, ".") {
			return true
		}

		if strings.HasPrefix(rule, ".") && strings.HasSuffix(host, rule) {
			return true
		}

		if rule == host {
			return true
		}

		if matched, err := path.Match(rule, host); err == nil && matched {
			return true
		}
	}

	return false
}

func pickWindowsProxyServer(proxyServer string, requestScheme string) string {
	trimmed := strings.TrimSpace(proxyServer)
	if trimmed == "" {
		return ""
	}

	if !strings.Contains(trimmed, "=") {
		return trimmed
	}

	proxies := make(map[string]string)
	firstValue := ""

	for _, part := range strings.Split(trimmed, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}

		key := strings.ToLower(strings.TrimSpace(kv[0]))
		value := strings.TrimSpace(kv[1])
		if key == "" || value == "" {
			continue
		}

		if firstValue == "" {
			firstValue = value
		}
		proxies[key] = value
	}

	if direct := proxies[requestScheme]; direct != "" {
		return direct
	}

	if requestScheme == "https" {
		if fallback := proxies["http"]; fallback != "" {
			return fallback
		}
	}

	if socks := proxies["socks"]; socks != "" {
		return ensureSocksScheme(socks)
	}
	if socks5 := proxies["socks5"]; socks5 != "" {
		return ensureSocksScheme(socks5)
	}

	return firstValue
}

func ensureSocksScheme(proxyValue string) string {
	if strings.Contains(proxyValue, "://") {
		return proxyValue
	}
	return "socks5://" + proxyValue
}

func normalizeProxyURL(proxySpec string) (*url.URL, error) {
	proxySpec = strings.TrimSpace(proxySpec)
	if proxySpec == "" {
		return nil, nil
	}

	if !strings.Contains(proxySpec, "://") {
		proxySpec = "http://" + proxySpec
	}

	proxyURL, err := url.Parse(proxySpec)
	if err != nil {
		return nil, nil
	}

	if proxyURL.Host == "" && proxyURL.Path != "" {
		proxyURL.Host = proxyURL.Path
		proxyURL.Path = ""
	}

	if proxyURL.Host == "" {
		return nil, nil
	}

	return proxyURL, nil
}

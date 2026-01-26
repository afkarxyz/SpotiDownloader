package backend

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

func BuildFilename(trackName, artistName, albumName, albumArtist, releaseDate string, discNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool, playlistName, playlistOwner string) string {
	safeTitle := SanitizeFilename(trackName)
	safeArtist := SanitizeFilename(artistName)
	safeAlbum := SanitizeFilename(albumName)
	safeAlbumArtist := SanitizeFilename(albumArtist)

	safePlaylist := SanitizeFilename(playlistName)
	safeCreator := SanitizeFilename(playlistOwner)

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	var filename string

	if strings.Contains(format, "{") {
		filename = format
		filename = strings.ReplaceAll(filename, "{title}", safeTitle)
		filename = strings.ReplaceAll(filename, "{artist}", safeArtist)
		filename = strings.ReplaceAll(filename, "{album}", safeAlbum)
		filename = strings.ReplaceAll(filename, "{album_artist}", safeAlbumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)
		filename = strings.ReplaceAll(filename, "{playlist}", safePlaylist)
		filename = strings.ReplaceAll(filename, "{creator}", safeCreator)

		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		if position > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", position))
		} else {

			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
		return filename
	}

	switch format {
	case "artist-title":
		filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
	case "title":
		filename = safeTitle
	default:
		filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
	}

	if includeTrackNumber && position > 0 {
		filename = fmt.Sprintf("%02d. %s", position, filename)
	}

	return filename
}

func SanitizeFilename(filename string) string {

	result := strings.ReplaceAll(filename, "/", " ")

	invalid := []string{"\\", ":", "*", "?", "\"", "<", ">", "|"}
	for _, char := range invalid {
		result = strings.ReplaceAll(result, char, " ")
	}

	var sanitized strings.Builder
	for _, r := range result {

		if r < 0x20 && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}
		if r == 0x7F {
			continue
		}

		sanitized.WriteRune(r)
	}

	result = sanitized.String()
	result = strings.TrimSpace(result)

	result = strings.Trim(result, ". ")

	re := regexp.MustCompile(`\s+`)
	result = re.ReplaceAllString(result, " ")

	re = regexp.MustCompile(`_+`)
	result = re.ReplaceAllString(result, "_")

	result = strings.Trim(result, "_ ")

	if result == "" {
		return "Unknown"
	}

	if !utf8.ValidString(result) {

		result = strings.ToValidUTF8(result, "_")
	}

	return result
}

func NormalizePath(folderPath string) string {

	return strings.ReplaceAll(folderPath, "/", string(filepath.Separator))
}

func SanitizeFolderPath(folderPath string) string {

	normalizedPath := strings.ReplaceAll(folderPath, "/", string(filepath.Separator))

	sep := string(filepath.Separator)

	parts := strings.Split(normalizedPath, sep)
	sanitizedParts := make([]string, 0, len(parts))

	for i, part := range parts {

		if i == 0 && len(part) == 2 && part[1] == ':' {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}

		if i == 0 && part == "" {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}

		sanitized := sanitizeFolderName(part)
		if sanitized != "" {
			sanitizedParts = append(sanitizedParts, sanitized)
		}
	}

	return strings.Join(sanitizedParts, sep)
}

func sanitizeFolderName(name string) string {

	return SanitizeFilename(name)
}

package backend

import (
	"fmt"
	"os"
	pathfilepath "path/filepath"
	"strconv"
	"strings"

	id3v2 "github.com/bogem/id3v2/v2"
	"github.com/go-flac/flacpicture"
	"github.com/go-flac/flacvorbis"
	"github.com/go-flac/go-flac"
)

type Metadata struct {
	Title       string
	Artist      string
	Album       string
	Date        string
	TrackNumber int
	DiscNumber  int
	ISRC        string
	Lyrics      string
}

func EmbedMetadata(filePath string, metadata Metadata, coverPath string) error {
	ext := strings.ToLower(pathfilepath.Ext(filePath))

	switch ext {
	case ".flac":
		return embedFlacMetadata(filePath, metadata, coverPath)
	case ".mp3":
		return embedMp3Metadata(filePath, metadata, coverPath)
	default:
		return fmt.Errorf("unsupported file format: %s", ext)
	}
}

func embedFlacMetadata(filePath string, metadata Metadata, coverPath string) error {
	f, err := flac.ParseFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	var cmtIdx = -1
	for idx, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmtIdx = idx
			break
		}
	}

	cmt := flacvorbis.New()

	if metadata.Title != "" {
		_ = cmt.Add(flacvorbis.FIELD_TITLE, metadata.Title)
	}
	if metadata.Artist != "" {
		_ = cmt.Add(flacvorbis.FIELD_ARTIST, metadata.Artist)
	}
	if metadata.Album != "" {
		_ = cmt.Add(flacvorbis.FIELD_ALBUM, metadata.Album)
	}
	if metadata.Date != "" {
		_ = cmt.Add(flacvorbis.FIELD_DATE, metadata.Date)
	}
	if metadata.TrackNumber > 0 {
		_ = cmt.Add(flacvorbis.FIELD_TRACKNUMBER, strconv.Itoa(metadata.TrackNumber))
	}
	if metadata.DiscNumber > 0 {
		_ = cmt.Add("DISCNUMBER", strconv.Itoa(metadata.DiscNumber))
	}
	if metadata.ISRC != "" {
		_ = cmt.Add(flacvorbis.FIELD_ISRC, metadata.ISRC)
	}
	if metadata.Lyrics != "" {
		_ = cmt.Add("LYRICS", metadata.Lyrics) // Or "UNSYNCEDLYRICS" for unsynced
	}

	cmtBlock := cmt.Marshal()
	if cmtIdx < 0 {
		f.Meta = append(f.Meta, &cmtBlock)
	} else {
		f.Meta[cmtIdx] = &cmtBlock
	}

	if coverPath != "" && fileExists(coverPath) {
		if err := embedCoverArt(f, coverPath); err != nil {
			fmt.Printf("Warning: Failed to embed cover art: %v\n", err)
		}
	}

	if err := f.Save(filePath); err != nil {
		return fmt.Errorf("failed to save FLAC file: %w", err)
	}

	return nil
}

func embedMp3Metadata(filePath string, metadata Metadata, coverPath string) error {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	// Set text frames
	if metadata.Title != "" {
		tag.SetTitle(metadata.Title)
	}
	if metadata.Artist != "" {
		tag.SetArtist(metadata.Artist)
	}
	if metadata.Album != "" {
		tag.SetAlbum(metadata.Album)
	}
	if metadata.Date != "" {
		tag.SetYear(metadata.Date)
	}
	if metadata.TrackNumber > 0 {
		tag.AddTextFrame(tag.CommonID("Track number/Position in set"), tag.DefaultEncoding(), strconv.Itoa(metadata.TrackNumber))
	}

	// Add ISRC (International Standard Recording Code)
	if metadata.ISRC != "" {
		// TSRC is the ID3v2 frame for ISRC
		tag.AddTextFrame("TSRC", tag.DefaultEncoding(), metadata.ISRC)
	}

	// Add cover art if provided
	if coverPath != "" && fileExists(coverPath) {
		artwork, err := os.ReadFile(coverPath)
		if err == nil {
			pic := id3v2.PictureFrame{
				Encoding:    id3v2.EncodingUTF8,
				MimeType:    "image/jpeg",
				PictureType: id3v2.PTFrontCover,
				Description: "Front cover",
				Picture:     artwork,
			}
			tag.AddAttachedPicture(pic)
		}
	}

	if err := tag.Save(); err != nil {
		return fmt.Errorf("failed to save MP3 tags: %w", err)
	}

	return nil
}

func embedCoverArt(f *flac.File, coverPath string) error {
	imgData, err := os.ReadFile(coverPath)
	if err != nil {
		return fmt.Errorf("failed to read cover image: %w", err)
	}

	picture, err := flacpicture.NewFromImageData(
		flacpicture.PictureTypeFrontCover,
		"Cover",
		imgData,
		"image/jpeg",
	)
	if err != nil {
		return fmt.Errorf("failed to create picture block: %w", err)
	}

	pictureBlock := picture.Marshal()

	for i := len(f.Meta) - 1; i >= 0; i-- {
		if f.Meta[i].Type == flac.Picture {
			f.Meta = append(f.Meta[:i], f.Meta[i+1:]...)
		}
	}

	f.Meta = append(f.Meta, &pictureBlock)

	return nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// EmbedLyricsOnly adds lyrics to a FLAC or MP3 file while preserving existing metadata
func EmbedLyricsOnly(filepath string, lyrics string) error {
	if lyrics == "" {
		return nil
	}

	ext := strings.ToLower(pathfilepath.Ext(filepath))
	switch ext {
	case ".flac":
		return embedLyricsToFlac(filepath, lyrics)
	case ".mp3":
		return embedLyricsToMp3(filepath, lyrics)
	default:
		return fmt.Errorf("unsupported file format for lyrics embedding: %s", ext)
	}
}

// embedLyricsToFlac adds lyrics to a FLAC file while preserving existing metadata
func embedLyricsToFlac(filepath string, lyrics string) error {
	f, err := flac.ParseFile(filepath)
	if err != nil {
		return fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	var cmtIdx = -1
	var existingCmt *flacvorbis.MetaDataBlockVorbisComment
	for idx, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmtIdx = idx
			existingCmt, err = flacvorbis.ParseFromMetaDataBlock(*block)
			if err != nil {
				existingCmt = nil
			}
			break
		}
	}

	// Create new comment block, preserving existing comments
	cmt := flacvorbis.New()

	// Copy existing comments except LYRICS
	if existingCmt != nil {
		for _, comment := range existingCmt.Comments {
			parts := strings.SplitN(comment, "=", 2)
			if len(parts) == 2 {
				fieldName := strings.ToUpper(parts[0])
				if fieldName != "LYRICS" && fieldName != "UNSYNCEDLYRICS" && fieldName != "SYNCEDLYRICS" {
					_ = cmt.Add(parts[0], parts[1])
				}
			}
		}
	}

	// Add lyrics
	_ = cmt.Add("LYRICS", lyrics)

	cmtBlock := cmt.Marshal()
	if cmtIdx < 0 {
		f.Meta = append(f.Meta, &cmtBlock)
	} else {
		f.Meta[cmtIdx] = &cmtBlock
	}

	if err := f.Save(filepath); err != nil {
		return fmt.Errorf("failed to save FLAC file: %w", err)
	}

	return nil
}

// embedLyricsToMp3 adds lyrics to an MP3 file using ID3v2 USLT frame while preserving existing metadata
func embedLyricsToMp3(filepath string, lyrics string) error {
	tag, err := id3v2.Open(filepath, id3v2.Options{Parse: true})
	if err != nil {
		return fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	// Remove existing USLT frames
	tag.DeleteFrames(tag.CommonID("Unsynchronised lyrics/text transcription"))

	// Add new USLT frame with lyrics
	// Use UTF-8 encoding for better compatibility with AIMP and other players
	usltFrame := id3v2.UnsynchronisedLyricsFrame{
		Encoding:          id3v2.EncodingUTF8, // Use UTF-8 instead of default encoding
		Language:          "eng",
		ContentDescriptor: "", // Empty descriptor for better compatibility
		Lyrics:            lyrics,
	}
	tag.AddUnsynchronisedLyricsFrame(usltFrame)

	if err := tag.Save(); err != nil {
		return fmt.Errorf("failed to save MP3 tags: %w", err)
	}

	return nil
}

// ReadISRCFromFile reads ISRC metadata from a FLAC or MP3 file
func ReadISRCFromFile(filePath string) (string, error) {
	if !fileExists(filePath) {
		return "", fmt.Errorf("file does not exist")
	}

	ext := strings.ToLower(pathfilepath.Ext(filePath))

	switch ext {
	case ".flac":
		return readISRCFromFlac(filePath)
	case ".mp3":
		return readISRCFromMp3(filePath)
	default:
		return "", fmt.Errorf("unsupported file format: %s", ext)
	}
}

// readISRCFromFlac reads ISRC from FLAC file
func readISRCFromFlac(filePath string) (string, error) {
	f, err := flac.ParseFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	// Find VorbisComment block
	for _, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmt, err := flacvorbis.ParseFromMetaDataBlock(*block)
			if err != nil {
				continue
			}

			// Get ISRC field
			isrcValues, err := cmt.Get(flacvorbis.FIELD_ISRC)
			if err == nil && len(isrcValues) > 0 {
				return isrcValues[0], nil
			}
		}
	}

	return "", nil // No ISRC found
}

// readISRCFromMp3 reads ISRC from MP3 file
func readISRCFromMp3(filePath string) (string, error) {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return "", fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	// TSRC is the ID3v2 frame for ISRC
	frames := tag.GetFrames("TSRC")
	if len(frames) > 0 {
		if textFrame, ok := frames[0].(id3v2.TextFrame); ok {
			return textFrame.Text, nil
		}
	}

	return "", nil // No ISRC found
}

// CheckISRCExists checks if a file with the given ISRC already exists in the directory
func CheckISRCExists(outputDir string, targetISRC string, audioFormat string) (string, bool) {
	if targetISRC == "" {
		return "", false
	}

	// Read all audio files in directory
	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return "", false
	}

	// Determine which extensions to check
	extensions := []string{".mp3", ".flac"}
	if audioFormat == "flac" {
		extensions = []string{".flac"} // Only check FLAC if format is FLAC
	} else if audioFormat == "mp3" {
		extensions = []string{".mp3"} // Only check MP3 if format is MP3
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		ext := strings.ToLower(pathfilepath.Ext(filename))

		// Check if extension matches
		validExt := false
		for _, validExtension := range extensions {
			if ext == validExtension {
				validExt = true
				break
			}
		}

		if !validExt {
			continue
		}

		filePath := pathfilepath.Join(outputDir, filename)

		// Read ISRC from file
		isrc, err := ReadISRCFromFile(filePath)
		if err != nil {
			continue
		}

		// Compare ISRC (case-insensitive)
		if isrc != "" && strings.EqualFold(isrc, targetISRC) {
			return filePath, true
		}
	}

	return "", false
}

// ExtractCoverArt extracts cover art from an audio file and saves it to a temporary file
func ExtractCoverArt(filePath string) (string, error) {
	ext := strings.ToLower(pathfilepath.Ext(filePath))
	
	switch ext {
	case ".mp3":
		return extractCoverFromMp3(filePath)
	case ".m4a", ".flac":
		return extractCoverFromM4AOrFlac(filePath)
	default:
		return "", fmt.Errorf("unsupported file format: %s", ext)
	}
}

// extractCoverFromMp3 extracts cover art from MP3 file
func extractCoverFromMp3(filePath string) (string, error) {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return "", fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	pictures := tag.GetFrames(tag.CommonID("Attached picture"))
	if len(pictures) == 0 {
		return "", fmt.Errorf("no cover art found")
	}

	pic, ok := pictures[0].(id3v2.PictureFrame)
	if !ok {
		return "", fmt.Errorf("invalid picture frame")
	}

	// Create temporary file
	tmpFile, err := os.CreateTemp("", "cover-*.jpg")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	defer tmpFile.Close()

	if _, err := tmpFile.Write(pic.Picture); err != nil {
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("failed to write cover art: %w", err)
	}

	return tmpFile.Name(), nil
}

// extractCoverFromM4AOrFlac extracts cover art from M4A or FLAC file
func extractCoverFromM4AOrFlac(filePath string) (string, error) {
	ext := strings.ToLower(pathfilepath.Ext(filePath))
	
	if ext == ".flac" {
		f, err := flac.ParseFile(filePath)
		if err != nil {
			return "", fmt.Errorf("failed to parse FLAC file: %w", err)
		}

		for _, block := range f.Meta {
			if block.Type == flac.Picture {
				pic, err := flacpicture.ParseFromMetaDataBlock(*block)
				if err != nil {
					continue
				}

				// Create temporary file
				tmpFile, err := os.CreateTemp("", "cover-*.jpg")
				if err != nil {
					return "", fmt.Errorf("failed to create temp file: %w", err)
				}
				defer tmpFile.Close()

				if _, err := tmpFile.Write(pic.ImageData); err != nil {
					os.Remove(tmpFile.Name())
					return "", fmt.Errorf("failed to write cover art: %w", err)
				}

				return tmpFile.Name(), nil
			}
		}
		return "", fmt.Errorf("no cover art found")
	}

	// For M4A, try to extract using ffmpeg or return empty
	// M4A cover art should be preserved by ffmpeg during conversion
	return "", nil
}

// ExtractLyrics extracts lyrics from an audio file
func ExtractLyrics(filePath string) (string, error) {
	ext := strings.ToLower(pathfilepath.Ext(filePath))
	
	switch ext {
	case ".mp3":
		return extractLyricsFromMp3(filePath)
	case ".flac":
		return extractLyricsFromFlac(filePath)
	case ".m4a":
		// M4A lyrics extraction would need different approach
		return "", nil
	default:
		return "", fmt.Errorf("unsupported file format: %s", ext)
	}
}

// extractLyricsFromMp3 extracts lyrics from MP3 file
func extractLyricsFromMp3(filePath string) (string, error) {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return "", fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	usltFrames := tag.GetFrames(tag.CommonID("Unsynchronised lyrics/text transcription"))
	if len(usltFrames) == 0 {
		return "", nil
	}

	uslt, ok := usltFrames[0].(id3v2.UnsynchronisedLyricsFrame)
	if !ok {
		return "", nil
	}

	return uslt.Lyrics, nil
}

// extractLyricsFromFlac extracts lyrics from FLAC file
func extractLyricsFromFlac(filePath string) (string, error) {
	f, err := flac.ParseFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	for _, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmt, err := flacvorbis.ParseFromMetaDataBlock(*block)
			if err != nil {
				continue
			}

			// Search through comments for lyrics
			for _, comment := range cmt.Comments {
				parts := strings.SplitN(comment, "=", 2)
				if len(parts) == 2 {
					fieldName := strings.ToUpper(parts[0])
					if fieldName == "LYRICS" || fieldName == "UNSYNCEDLYRICS" {
						return parts[1], nil
					}
				}
			}
		}
	}

	return "", nil
}

// EmbedCoverArtOnly embeds cover art into an audio file
func EmbedCoverArtOnly(filePath string, coverPath string) error {
	if coverPath == "" || !fileExists(coverPath) {
		return nil
	}

	ext := strings.ToLower(pathfilepath.Ext(filePath))
	
	switch ext {
	case ".mp3":
		return embedCoverToMp3(filePath, coverPath)
	case ".m4a":
		// M4A cover art should be handled by ffmpeg during conversion
		// If not, we can try to embed using atomicparsley or similar tool
		// For now, return nil as ffmpeg should handle it
		return nil
	default:
		return fmt.Errorf("unsupported file format: %s", ext)
	}
}

// embedCoverToMp3 embeds cover art into MP3 file
func embedCoverToMp3(filePath string, coverPath string) error {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	// Remove existing cover art
	tag.DeleteFrames(tag.CommonID("Attached picture"))

	// Read cover art
	artwork, err := os.ReadFile(coverPath)
	if err != nil {
		return fmt.Errorf("failed to read cover art: %w", err)
	}

	// Add new cover art
	pic := id3v2.PictureFrame{
		Encoding:    id3v2.EncodingUTF8,
		MimeType:    "image/jpeg",
		PictureType: id3v2.PTFrontCover,
		Description: "Front cover",
		Picture:     artwork,
	}
	tag.AddAttachedPicture(pic)

	if err := tag.Save(); err != nil {
		return fmt.Errorf("failed to save MP3 tags: %w", err)
	}

	return nil
}

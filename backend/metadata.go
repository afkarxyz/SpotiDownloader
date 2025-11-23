package backend

import (
	"fmt"
	"os"
	"path/filepath"
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
}

func EmbedMetadata(filePath string, metadata Metadata, coverPath string) error {
	ext := strings.ToLower(filepath.Ext(filePath))

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

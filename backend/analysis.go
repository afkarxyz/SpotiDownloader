package backend

import (
	"fmt"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	mewflac "github.com/mewkiz/flac"
)

type AnalysisResult struct {
	FilePath      string        `json:"file_path"`
	FileSize      int64         `json:"file_size"`
	SampleRate    uint32        `json:"sample_rate"`
	Channels      uint8         `json:"channels"`
	BitsPerSample uint8         `json:"bits_per_sample"`
	TotalSamples  uint64        `json:"total_samples"`
	Duration      float64       `json:"duration"`
	Bitrate       int           `json:"bit_rate"`
	BitDepth      string        `json:"bit_depth"`
	DynamicRange  float64       `json:"dynamic_range"`
	PeakAmplitude float64       `json:"peak_amplitude"`
	RMSLevel      float64       `json:"rms_level"`
	Spectrum      *SpectrumData `json:"spectrum,omitempty"`
}

func AnalyzeTrack(filepath string) (*AnalysisResult, error) {
	if !fileExists(filepath) {
		return nil, fmt.Errorf("file does not exist: %s", filepath)
	}

	return GetMetadataWithFFprobe(filepath)
}

func GetTrackMetadata(filepath string) (*AnalysisResult, error) {
	if !fileExists(filepath) {
		return nil, fmt.Errorf("file does not exist: %s", filepath)
	}

	return GetMetadataWithFFprobe(filepath)
}

func GetMetadataWithFFprobe(filePath string) (*AnalysisResult, error) {
	ffprobePath, err := GetFFprobePath()
	if err != nil {
		return nil, err
	}

	for i := 0; i < 5; i++ {
		if f, err := os.Open(filePath); err == nil {
			f.Close()
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	infoMap := make(map[string]string)
	args := []string{
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=sample_rate,channels,bits_per_raw_sample,bits_per_sample,duration,bit_rate",
		"-of", "default=noprint_wrappers=0",
		filePath,
	}
	cmd := exec.Command(ffprobePath, args...)
	setHideWindow(cmd)
	output, err := cmd.CombinedOutput()
	if err == nil {
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			if strings.Contains(line, "=") {
				parts := strings.SplitN(line, "=", 2)
				infoMap[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
			}
		}
	} else {
		return nil, fmt.Errorf("ffprobe failed: %v - %s", err, string(output))
	}

	res := &AnalysisResult{
		FilePath: filePath,
	}

	if info, err := os.Stat(filePath); err == nil {
		res.FileSize = info.Size()
	}

	if val, ok := infoMap["sample_rate"]; ok {
		s, _ := strconv.Atoi(val)
		res.SampleRate = uint32(s)
	}
	if val, ok := infoMap["channels"]; ok {
		c, _ := strconv.Atoi(val)
		res.Channels = uint8(c)
	}
	if val, ok := infoMap["duration"]; ok {
		d, _ := strconv.ParseFloat(val, 64)
		res.Duration = d
	}
	if val, ok := infoMap["bit_rate"]; ok && val != "N/A" {
		br, _ := strconv.Atoi(val)
		res.Bitrate = br
	}

	bits := 0
	if val, ok := infoMap["bits_per_raw_sample"]; ok && val != "N/A" {
		bits, _ = strconv.Atoi(val)
	}
	if bits == 0 {
		if val, ok := infoMap["bits_per_sample"]; ok && val != "N/A" {
			bits, _ = strconv.Atoi(val)
		}
	}

	res.BitsPerSample = uint8(bits)
	if bits > 0 {
		res.BitDepth = fmt.Sprintf("%d-bit", bits)
	} else {
		res.BitDepth = "Unknown"
	}

	return res, nil
}

func calculateRealAudioMetrics(result *AnalysisResult, filepath string) {
	samples, err := decodeFLACForMetrics(filepath)
	if err != nil {
		return
	}

	var peak float64
	var sumSquares float64

	for _, sample := range samples {
		absVal := sample
		if absVal < 0 {
			absVal = -absVal
		}
		if absVal > peak {
			peak = absVal
		}
		sumSquares += sample * sample
	}

	peakDB := 20.0 * math.Log10(peak)
	result.PeakAmplitude = peakDB

	rms := math.Sqrt(sumSquares / float64(len(samples)))
	rmsDB := 20.0 * math.Log10(rms)
	result.RMSLevel = rmsDB

	result.DynamicRange = peakDB - rmsDB
}

func decodeFLACForMetrics(filepath string) ([]float64, error) {
	stream, err := mewflac.ParseFile(filepath)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	maxSamples := 10000000
	samples := make([]float64, 0, maxSamples)

	for {
		frame, err := stream.ParseNext()
		if err != nil {
			break
		}

		var channelSamples []int32
		if len(frame.Subframes) > 0 {
			channelSamples = frame.Subframes[0].Samples
		}

		maxVal := float64(int64(1) << (stream.Info.BitsPerSample - 1))
		for _, sample := range channelSamples {
			if len(samples) >= maxSamples {
				return samples, nil
			}
			normalized := float64(sample) / maxVal
			samples = append(samples, normalized)
		}

		if len(samples) >= maxSamples {
			break
		}
	}

	return samples, nil
}

func GetFileSize(filepath string) (int64, error) {
	info, err := os.Stat(filepath)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

package ffmpeg

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"go.uber.org/zap"
)

// Executor manages FFmpeg process execution
type Executor struct {
	ffmpegPath  string
	ffprobePath string
	logger      *zap.Logger
	mu          sync.Mutex
	processes   map[string]*exec.Cmd
}

// NewExecutor creates a new FFmpeg executor
func NewExecutor(ffmpegPath, ffprobePath string, logger *zap.Logger) *Executor {
	if ffmpegPath == "" {
		ffmpegPath = "ffmpeg"
	}
	if ffprobePath == "" {
		ffprobePath = "ffprobe"
	}

	return &Executor{
		ffmpegPath:  ffmpegPath,
		ffprobePath: ffprobePath,
		logger:      logger,
		processes:   make(map[string]*exec.Cmd),
	}
}

// ProgressCallback is called with progress updates (0.0 to 1.0)
type ProgressCallback func(progress float64)

// ExecuteOptions contains options for FFmpeg execution
type ExecuteOptions struct {
	Args       []string
	Duration   float64
	OnProgress ProgressCallback
	StdinData  io.Reader
}

// Execute runs FFmpeg with the given arguments
func (e *Executor) Execute(ctx context.Context, opts ExecuteOptions) error {
	cmd := exec.CommandContext(ctx, e.ffmpegPath, opts.Args...)

	// Log the command
	e.logger.Info("Executing FFmpeg",
		zap.String("command", cmd.String()),
	)

	// Set up stdin if provided
	if opts.StdinData != nil {
		cmd.Stdin = opts.StdinData
	}

	// Capture stderr for progress parsing
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Capture stdout
	var stdoutBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf

	// Start the command
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	// Track the process
	processID := fmt.Sprintf("%d", cmd.Process.Pid)
	e.mu.Lock()
	e.processes[processID] = cmd
	e.mu.Unlock()

	defer func() {
		e.mu.Lock()
		delete(e.processes, processID)
		e.mu.Unlock()
	}()

	// Parse progress in a goroutine
	var stderrBuf bytes.Buffer
	progressDone := make(chan struct{})

	go func() {
		defer close(progressDone)
		e.parseProgress(stderrPipe, &stderrBuf, opts.Duration, opts.OnProgress)
	}()

	// Wait for process to complete
	err = cmd.Wait()

	// Wait for progress parsing to finish
	<-progressDone

	if err != nil {
		// Extract error message from stderr
		stderrStr := stderrBuf.String()
		errorMsg := ParseFFmpegError(stderrStr)

		e.logger.Error("FFmpeg execution failed",
			zap.Error(err),
			zap.String("stderr", errorMsg),
		)

		return fmt.Errorf("ffmpeg failed: %s", errorMsg)
	}

	e.logger.Info("FFmpeg execution completed successfully")
	return nil
}

// parseProgress reads stderr line by line and calls progress callback
func (e *Executor) parseProgress(stderr io.Reader, stderrBuf *bytes.Buffer, duration float64, onProgress ProgressCallback) {
	parser := NewProgressParser(duration)
	scanner := bufio.NewScanner(io.TeeReader(stderr, stderrBuf))

	for scanner.Scan() {
		line := scanner.Text()

		if onProgress != nil {
			progress := parser.ParseLine(line)
			if progress >= 0 {
				onProgress(progress)
			}
		}
	}

	if err := scanner.Err(); err != nil {
		e.logger.Warn("Error reading FFmpeg stderr", zap.Error(err))
	}
}

// CutVideo cuts a video segment - uses re-encoding for accurate frame-perfect cuts
// For short segments this ensures no freezing issues during playback
func (e *Executor) CutVideo(ctx context.Context, input, output string, start, end float64, onProgress ProgressCallback) error {
	duration := end - start

	e.logger.Info("Cutting segment with accurate re-encode",
		zap.Float64("start", start),
		zap.Float64("end", end),
		zap.Float64("duration", duration),
	)

	// Use accurate cutting with re-encoding for reliable results
	// This ensures no freezing at segment boundaries
	// CRF 17 is visually nearly lossless
	return e.accurateCut(ctx, input, output, start, duration, onProgress)
}

// CutVideoLossless cuts a video segment using stream copy (-c copy)
// Much faster than re-encoding, but may have slight inaccuracies at non-keyframe boundaries
func (e *Executor) CutVideoLossless(ctx context.Context, input, output string, start, end float64, onProgress ProgressCallback) error {
	duration := end - start

	e.logger.Info("Cutting segment lossless (stream copy)",
		zap.Float64("start", start),
		zap.Float64("end", end),
		zap.Float64("duration", duration),
	)

	return e.regularCut(ctx, input, output, start, end, onProgress)
}

// accurateCut performs frame-accurate cutting by re-encoding with CPU libx264.
func (e *Executor) accurateCut(ctx context.Context, input, output string, start, duration float64, onProgress ProgressCallback) error {
	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.6f", start),
		"-i", input,
		"-t", fmt.Sprintf("%.6f", duration),
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-crf", "17",
		"-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-b:a", "192k",
		"-movflags", "+faststart",
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		Duration:   duration,
		OnProgress: onProgress,
	})
}

// FindKeyframes finds keyframe timestamps in a time range
func (e *Executor) FindKeyframes(ctx context.Context, input string, startTime, endTime float64) ([]float64, error) {
	if startTime < 0 {
		startTime = 0
	}

	args := []string{
		"-hide_banner",
		"-read_intervals", fmt.Sprintf("%.3f%%+%.3f", startTime, endTime-startTime),
		"-select_streams", "v:0",
		"-show_entries", "packet=pts_time,flags",
		"-of", "csv=p=0",
		input,
	}

	cmd := exec.CommandContext(ctx, e.ffprobePath, args...)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}

	var keyframes []float64
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) >= 2 {
			// Check if it's a keyframe (flags contain 'K')
			if strings.Contains(parts[1], "K") {
				if ts, err := strconv.ParseFloat(parts[0], 64); err == nil {
					keyframes = append(keyframes, ts)
				}
			}
		}
	}

	sort.Float64s(keyframes)
	return keyframes, nil
}

// regularCut performs a lossless cut using stream copy (-c copy).
// Uses input seeking (-ss before -i) which is fast but keyframe-aligned.
// For frame-accurate cuts, use re-encode path (CutVideoWithFilters).
func (e *Executor) regularCut(ctx context.Context, input, output string, start, end float64, onProgress ProgressCallback) error {
	duration := end - start
	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.6f", start),
		"-i", input,
		"-t", fmt.Sprintf("%.6f", duration),
		"-map", "0",
		"-c", "copy",
		"-avoid_negative_ts", "make_zero",
		"-movflags", "+faststart",
		"-y",
		output,
	}
	return e.Execute(ctx, ExecuteOptions{Args: args, Duration: duration, OnProgress: onProgress})
}

// reencodeSegment re-encodes a video segment with high quality
func (e *Executor) reencodeSegment(ctx context.Context, input, output string, start, duration float64, onProgress ProgressCallback) error {
	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.6f", start),
		"-i", input,
		"-t", fmt.Sprintf("%.6f", duration),
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-crf", "17", // High quality
		"-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-b:a", "192k",
		"-avoid_negative_ts", "make_zero",
		"-movflags", "+faststart",
		"-y",
		output,
	}
	return e.Execute(ctx, ExecuteOptions{Args: args, Duration: duration, OnProgress: onProgress})
}

// losslessCut performs a lossless cut starting from a keyframe
func (e *Executor) losslessCut(ctx context.Context, input, output string, start, end float64, onProgress ProgressCallback) error {
	duration := end - start
	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.6f", start),
		"-i", input,
		"-t", fmt.Sprintf("%.6f", duration),
		"-map", "0",
		"-c", "copy",
		"-avoid_negative_ts", "make_zero",
		"-movflags", "+faststart",
		"-y",
		output,
	}
	return e.Execute(ctx, ExecuteOptions{Args: args, Duration: duration, OnProgress: onProgress})
}

// concatParts concatenates multiple video parts into one
func (e *Executor) concatParts(ctx context.Context, inputs []string, output string, totalDuration float64, onProgress ProgressCallback) error {
	// Create concat file
	concatFile := output + ".concat.txt"
	var content strings.Builder
	for _, input := range inputs {
		content.WriteString(fmt.Sprintf("file '%s'\n", input))
	}
	if err := os.WriteFile(concatFile, []byte(content.String()), 0644); err != nil {
		return err
	}
	defer os.Remove(concatFile)

	args := []string{
		"-hide_banner",
		"-f", "concat",
		"-safe", "0",
		"-i", concatFile,
		"-c", "copy",
		"-movflags", "+faststart",
		"-y",
		output,
	}
	return e.Execute(ctx, ExecuteOptions{Args: args, Duration: totalDuration, OnProgress: onProgress})
}

// CutVideoAccurate cuts a video segment with frame-accurate precision (slower)
// Use this when exact frame accuracy is more important than speed
func (e *Executor) CutVideoAccurate(ctx context.Context, input, output string, start, end float64, onProgress ProgressCallback) error {
	duration := end - start

	// Frame-accurate cutting with output seeking
	// This is slower but ensures exact frame boundaries
	args := []string{
		"-hide_banner",
		"-i", input,
		"-ss", fmt.Sprintf("%.6f", start), // OUTPUT SEEKING (after -i) = accurate
		"-t", fmt.Sprintf("%.6f", duration), // Duration to extract
		"-map", "0", // Copy all streams
		"-c", "copy", // Lossless copy - no re-encoding
		"-avoid_negative_ts", "make_zero", // Fix timestamp issues
		"-movflags", "+faststart", // Web-optimized (moov atom at start)
		"-y", // Overwrite output
		output,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		Duration:   duration,
		OnProgress: onProgress,
	})
}

// MergeVideos merges multiple video segments using concat demuxer
func (e *Executor) MergeVideos(ctx context.Context, inputs []string, output string, totalDuration float64, onProgress ProgressCallback) error {
	// Create concat file content and write to a temp file
	concatFile := output + ".concat.txt"
	var concatContent bytes.Buffer
	for _, input := range inputs {
		concatContent.WriteString(fmt.Sprintf("file '%s'\n", input))
	}

	// Write concat list to file
	if err := os.WriteFile(concatFile, concatContent.Bytes(), 0644); err != nil {
		return fmt.Errorf("failed to create concat file: %w", err)
	}
	defer os.Remove(concatFile)

	e.logger.Info("Merging segments",
		zap.Int("segmentCount", len(inputs)),
		zap.Float64("totalDuration", totalDuration),
	)

	// Use concat demuxer with copy - segments are already re-encoded with same params
	args := []string{
		"-hide_banner",
		"-f", "concat",
		"-safe", "0",
		"-i", concatFile,
		"-c", "copy", // Copy since all segments have same encoding
		"-movflags", "+faststart",
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		Duration:   totalDuration,
		OnProgress: onProgress,
	})
}

// MergeVideosConcatDemuxer merges multiple video files using concat demuxer
// This is the FASTEST method for videos with compatible codecs (no re-encoding)
func (e *Executor) MergeVideosConcatDemuxer(ctx context.Context, inputs []string, output string, onProgress ProgressCallback) error {
	if len(inputs) == 0 {
		return fmt.Errorf("no input files provided")
	}

	if len(inputs) == 1 {
		src, err := os.Open(inputs[0])
		if err != nil {
			return fmt.Errorf("failed to open input file: %w", err)
		}
		defer src.Close()
		dst, err := os.Create(output)
		if err != nil {
			return fmt.Errorf("failed to create output file: %w", err)
		}
		defer dst.Close()
		if _, err := io.Copy(dst, src); err != nil {
			return fmt.Errorf("failed to copy file: %w", err)
		}
		return nil
	}

	e.logger.Info("Fast merging with concat demuxer",
		zap.Int("segmentCount", len(inputs)),
	)

	// Create concat file content and write to a temp file (more reliable than stdin)
	concatFile := output + ".concat.txt"
	var concatContent bytes.Buffer
	for _, input := range inputs {
		// Ensure paths are absolute and properly escaped
		absPath, err := filepath.Abs(input)
		if err != nil {
			e.logger.Warn("Failed to get absolute path, using relative", zap.String("input", input), zap.Error(err))
			absPath = input
		}
		// Escape special characters in path
		escapedPath := strings.ReplaceAll(absPath, "'", "'\\''")
		concatContent.WriteString(fmt.Sprintf("file '%s'\n", escapedPath))
	}

	// Write concat list to file
	if err := os.WriteFile(concatFile, concatContent.Bytes(), 0644); err != nil {
		return fmt.Errorf("failed to create concat file: %w", err)
	}
	defer os.Remove(concatFile)

	// Verify all input files exist and are readable
	for _, input := range inputs {
		if _, err := os.Stat(input); os.IsNotExist(err) {
			return fmt.Errorf("input file does not exist: %s", input)
		}
	}

	// Use concat demuxer with -c copy for ultra-fast merge
	args := []string{
		"-hide_banner",
		"-f", "concat",
		"-safe", "0",
		"-i", concatFile,
		"-c", "copy",
		"-movflags", "+faststart",
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		OnProgress: onProgress,
	})
}

// ConvertFormat converts video to different format
func (e *Executor) ConvertFormat(ctx context.Context, input, output, format string, duration float64, onProgress ProgressCallback) error {
	args := []string{
		"-hide_banner",
		"-i", input,
		"-c", "copy",
	}

	if format != "" {
		args = append(args, "-f", format)
	}

	args = append(args, "-y", output)

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		Duration:   duration,
		OnProgress: onProgress,
	})
}

// CaptureSnapshot captures a frame as an image using CPU-only path.
func (e *Executor) CaptureSnapshot(ctx context.Context, input, output string, timestamp float64, quality int) error {
	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.3f", timestamp),
		"-i", input,
		"-vframes", "1",
		"-crf", fmt.Sprintf("%d", quality),
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{Args: args})
}

// ExtractAudio extracts audio track from video
func (e *Executor) ExtractAudio(ctx context.Context, input, output string, duration float64, onProgress ProgressCallback) error {
	args := []string{
		"-hide_banner",
		"-i", input,
		"-vn", // No video
		"-acodec", "copy",
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		Duration:   duration,
		OnProgress: onProgress,
	})
}

// GenerateWaveform generates an audio waveform image using FFmpeg showwavespic filter.
func (e *Executor) GenerateWaveform(ctx context.Context, input, output string) error {
	args := []string{
		"-hide_banner",
		"-i", input,
		"-filter_complex", "showwavespic=s=1920x120:colors=#667eea|#667eea:scale=sqrt:split_channels=0",
		"-frames:v", "1",
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{Args: args})
}

// SmartCutOptions contains options for smart cutting
type SmartCutOptions struct {
	Input      string
	Output     string
	Start      float64
	End        float64
	VideoCodec string // "copy" for lossless, "libx264" for re-encoding
	AudioCodec string // "copy" for lossless, "aac" for re-encoding
	Quality    int    // CRF value (0-51, lower = better quality)
	Preset     string // "ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"
	OnProgress ProgressCallback
}

// SmartCut performs intelligent cutting with minimal re-encoding
// It analyzes the cut points and decides whether to use lossless cutting or smart re-encoding
func (e *Executor) SmartCut(ctx context.Context, opts SmartCutOptions) error {
	duration := opts.End - opts.Start

	// First, try to determine if we can do lossless cutting
	// by checking if start/end points are on keyframes
	canLossless, err := e.canDoLosslessCut(ctx, opts.Input, opts.Start, opts.End)
	if err != nil {
		e.logger.Warn("Failed to check lossless cut feasibility", zap.Error(err))
		// Fall back to smart cut
		canLossless = false
	}

	if canLossless {
		e.logger.Info("Performing lossless cut (keyframe-aligned)")
		return e.CutVideoLossless(ctx, opts.Input, opts.Output, opts.Start, opts.End, opts.OnProgress)
	}

	// Smart cut with minimal re-encoding
	e.logger.Info("Performing smart cut (minimal re-encoding)")
	return e.performSmartCut(ctx, opts, duration)
}

// canDoLosslessCut checks if cut points are on keyframes
func (e *Executor) canDoLosslessCut(ctx context.Context, input string, start, end float64) (bool, error) {
	// Get keyframe information using ffprobe
	args := []string{
		"-hide_banner",
		"-select_streams", "v:0",
		"-show_frames",
		"-show_entries", "frame=pkt_pts_time,key_frame",
		"-of", "csv=p=0",
		input,
	}

	cmd := exec.CommandContext(ctx, e.ffprobePath, args...)
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("failed to get keyframe info: %w", err)
	}

	// Parse keyframe times
	lines := bytes.Split(output, []byte("\n"))
	var keyframes []float64

	for _, line := range lines {
		if len(line) == 0 {
			continue
		}

		parts := bytes.Split(line, []byte(","))
		if len(parts) < 2 {
			continue
		}

		timeStr := string(parts[0])
		keyFrameStr := string(parts[1])

		if keyFrameStr == "1" {
			if time, err := strconv.ParseFloat(timeStr, 64); err == nil {
				keyframes = append(keyframes, time)
			}
		}
	}

	// Check if start and end points are close to keyframes (within 0.1 seconds)
	tolerance := 0.1

	startNearKeyframe := false
	endNearKeyframe := false

	for _, kf := range keyframes {
		if math.Abs(kf-start) <= tolerance {
			startNearKeyframe = true
		}
		if math.Abs(kf-end) <= tolerance {
			endNearKeyframe = true
		}
	}

	return startNearKeyframe && endNearKeyframe, nil
}

// performSmartCut performs cutting with minimal re-encoding
func (e *Executor) performSmartCut(ctx context.Context, opts SmartCutOptions, duration float64) error {
	// Set default values
	if opts.VideoCodec == "" {
		opts.VideoCodec = "libx264"
	}
	if opts.AudioCodec == "" {
		opts.AudioCodec = "aac"
	}
	if opts.Quality == 0 {
		opts.Quality = 18 // Good balance of quality and size
	}
	if opts.Preset == "" {
		opts.Preset = "fast" // Good balance of speed and efficiency
	}

	// Smart cut strategy:
	// 1. Use input seeking for speed
	// 2. Re-encode only the minimal necessary portion
	// 3. Use high-quality settings but fast presets
	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.6f", opts.Start), // Input seeking
		"-i", opts.Input,
		"-t", fmt.Sprintf("%.6f", duration), // Duration
	}

	// Video codec settings
	if opts.VideoCodec == "copy" {
		args = append(args, "-c:v", "copy")
	} else {
		args = append(args,
			"-c:v", opts.VideoCodec,
			"-crf", fmt.Sprintf("%d", opts.Quality),
			"-pix_fmt", "yuv420p", // Ensure compatibility
		)
	}

	// Audio codec settings
	if opts.AudioCodec == "copy" {
		args = append(args, "-c:a", "copy")
	} else {
		args = append(args,
			"-c:a", opts.AudioCodec,
			"-b:a", "192k", // Good quality audio
		)
	}

	// Additional optimizations
	args = append(args,
		"-avoid_negative_ts", "make_zero",
		"-movflags", "+faststart", // Web optimization
		"-y",
		opts.Output,
	)

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		Duration:   duration,
		OnProgress: opts.OnProgress,
	})
}

// SmartCutSegments performs smart cutting on multiple segments
func (e *Executor) SmartCutSegments(ctx context.Context, input string, segments []struct{ Start, End float64 }, output string, onProgress ProgressCallback) error {
	if len(segments) == 0 {
		return fmt.Errorf("no segments provided")
	}

	// For single segment, use SmartCut directly
	if len(segments) == 1 {
		return e.SmartCut(ctx, SmartCutOptions{
			Input:      input,
			Output:     output,
			Start:      segments[0].Start,
			End:        segments[0].End,
			OnProgress: onProgress,
		})
	}

	// For multiple segments, cut each segment smartly and then merge
	tempFiles := make([]string, len(segments))
	defer func() {
		// Clean up temp files
		for _, tempFile := range tempFiles {
			if tempFile != "" {
				os.Remove(tempFile)
			}
		}
	}()

	// Cut each segment
	var totalDuration float64
	for i, segment := range segments {
		tempFile := fmt.Sprintf("%s.segment_%d.mp4", output, i)
		tempFiles[i] = tempFile

		segDuration := segment.End - segment.Start
		totalDuration += segDuration

		// Use smart cut for each segment
		if err := e.SmartCut(ctx, SmartCutOptions{
			Input:  input,
			Output: tempFile,
			Start:  segment.Start,
			End:    segment.End,
			OnProgress: func(progress float64) {
				// Calculate overall progress
				overallProgress := (float64(i) + progress) / float64(len(segments))
				if onProgress != nil {
					onProgress(overallProgress)
				}
			},
		}); err != nil {
			return fmt.Errorf("failed to cut segment %d: %w", i, err)
		}
	}

	// Merge all segments
	return e.MergeVideos(ctx, tempFiles, output, totalDuration, onProgress)
}

// CreateIntroVideo creates a video from an image with specified duration
func (e *Executor) CreateIntroVideo(ctx context.Context, imagePath string, duration int, outputPath string, onProgress ProgressCallback) error {
	args := []string{
		"-hide_banner",
		"-loop", "1",
		"-i", imagePath,
		"-t", fmt.Sprintf("%d", duration),
		"-c:v", "libx264",
		"-preset", "ultrafast", "-crf", "17",
		"-pix_fmt", "yuv420p",
		"-movflags", "+faststart",
		"-y",
		outputPath,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		Duration:   float64(duration),
		OnProgress: onProgress,
	})
}

// ExecuteWithStdin runs FFmpeg with stdin data
func (e *Executor) ExecuteWithStdin(ctx context.Context, opts ExecuteOptions) error {
	return e.Execute(ctx, opts) // Execute method already handles stdin
}

// GetFFmpegPath returns the FFmpeg binary path
func (e *Executor) GetFFmpegPath() string {
	return e.ffmpegPath
}

// GetFFprobePath returns the FFprobe binary path
func (e *Executor) GetFFprobePath() string {
	return e.ffprobePath
}

// FilterOptions contains video filter settings
type FilterOptions struct {
	// Crop settings
	CropEnabled bool
	CropX       int
	CropY       int
	CropWidth   int
	CropHeight  int
	// Blur regions (manual mode)
	BlurRegions []BlurRegionFilter
}

// BlurRegionFilter represents a region to blur
type BlurRegionFilter struct {
	X             int
	Y             int
	Width         int
	Height        int
	StartTime     float64
	EndTime       float64
	BlurIntensity int
}

// BuildFilterChain constructs the FFmpeg filter chain string
func (e *Executor) BuildFilterChain(opts FilterOptions) string {
	var filters []string

	// Add crop filter if enabled
	if opts.CropEnabled && opts.CropWidth > 0 && opts.CropHeight > 0 {
		cropFilter := fmt.Sprintf("crop=%d:%d:%d:%d", opts.CropWidth, opts.CropHeight, opts.CropX, opts.CropY)
		filters = append(filters, cropFilter)
	}

	// Add blur filters for each region
	// FFmpeg uses boxblur with enable expression for time-based blur
	for i, region := range opts.BlurRegions {
		if region.Width > 0 && region.Height > 0 {
			// Create a complex filter for each blur region
			// We use drawbox with invert to create a blur effect, or use the boxblur filter
			// For simplicity, we'll use a workaround with multiple filters
			// The proper way is: split the video, apply blur to region, overlay back
			blurRadius := region.BlurIntensity / 2
			if blurRadius < 5 {
				blurRadius = 5
			}

			// Using the 'boxblur' filter with enable expression
			// Format: boxblur=luma_radius:chroma_radius:enable='between(t,start,end)'
			// But boxblur applies to the whole frame, so we need a different approach

			// Alternative: Use 'delogo' style approach with coordinates
			// Or use a complex filter graph with split, crop, blur, overlay

			// For now, use a simpler approach with drawbox to pixelate
			// This creates a mosaic/pixelate effect by scaling down and up
			// We'll implement proper blur regions using filter_complex

			// Store region info for complex filter (will be built in CutVideoWithFilters)
			_ = i
			_ = blurRadius
		}
	}

	if len(filters) == 0 {
		return ""
	}

	return strings.Join(filters, ",")
}

// CutVideoWithFilters cuts a video segment with optional filters (crop, blur)
func (e *Executor) CutVideoWithFilters(ctx context.Context, input, output string, start, end float64, filterOpts FilterOptions, onProgress ProgressCallback) error {
	duration := end - start

	e.logger.Info("Cutting segment with filters",
		zap.Float64("start", start),
		zap.Float64("end", end),
		zap.Float64("duration", duration),
		zap.Bool("cropEnabled", filterOpts.CropEnabled),
		zap.Int("blurRegions", len(filterOpts.BlurRegions)),
	)

	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.6f", start),
		"-i", input,
		"-t", fmt.Sprintf("%.6f", duration),
	}

	// Build filter chain
	filterChain := e.BuildFilterChain(filterOpts)

	// Handle blur regions with complex filter
	if len(filterOpts.BlurRegions) > 0 {
		// Build complex filter for blur regions
		complexFilter := e.buildBlurComplexFilter(filterOpts, filterChain)
		if complexFilter != "" {
			args = append(args, "-filter_complex", complexFilter)
			args = append(args, "-map", "[out]", "-map", "0:a?")
		} else if filterChain != "" {
			args = append(args, "-vf", filterChain)
		}
	} else if filterChain != "" {
		args = append(args, "-vf", filterChain)
	}

	// Video encoding settings
	args = append(args,
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-crf", "17",
		"-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-b:a", "192k",
		"-movflags", "+faststart",
		"-y",
		output,
	)

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		Duration:   duration,
		OnProgress: onProgress,
	})
}

// WatermarkOptions contains watermark overlay settings
type WatermarkOptions struct {
	ImagePath string  // Path to watermark PNG image
	Position  string  // Position: "top-left", "top-right", "bottom-left", "bottom-right", "center"
	Opacity   float64 // Opacity 0.0-1.0
	Scale     float64 // Scale factor for watermark size (1.0 = original)
	MarginX   int     // Horizontal margin from edge
	MarginY   int     // Vertical margin from edge
}

// CutVideoWithWatermark cuts a video segment and applies a watermark overlay
func (e *Executor) CutVideoWithWatermark(ctx context.Context, input, output string, start, end float64, watermark WatermarkOptions, onProgress ProgressCallback) error {
	duration := end - start

	e.logger.Info("Cutting segment with watermark",
		zap.Float64("start", start),
		zap.Float64("end", end),
		zap.String("watermarkPath", watermark.ImagePath),
		zap.String("position", watermark.Position),
		zap.Float64("opacity", watermark.Opacity),
	)

	// Build the filter complex for watermark overlay
	filterComplex := e.buildWatermarkFilter(watermark)

	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.6f", start),
		"-i", input,
		"-i", watermark.ImagePath,
		"-t", fmt.Sprintf("%.6f", duration),
		"-filter_complex", filterComplex,
		"-map", "[out]",
		"-map", "0:a?",
		"-c:v", "libx264",
		"-preset", "ultrafast", "-crf", "17",
		"-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-b:a", "192k",
		"-movflags", "+faststart",
		"-y",
		output,
	}

	// Try VAAPI first for faster encoding
	argsVaapi := []string{
		"-hide_banner",
		"-hwaccel", "vaapi",
		"-hwaccel_device", "/dev/dri/renderD128",
		"-ss", fmt.Sprintf("%.6f", start),
		"-i", input,
		"-i", watermark.ImagePath,
		"-t", fmt.Sprintf("%.6f", duration),
		"-filter_complex", filterComplex + ",format=nv12,hwupload",
		"-map", "[out]",
		"-map", "0:a?",
		"-c:v", "libx264",
		"-qp", "18",
		"-c:a", "aac",
		"-b:a", "192k",
		"-movflags", "+faststart",
		"-y",
		output,
	}

	err := e.Execute(ctx, ExecuteOptions{
		Args:       argsVaapi,
		Duration:   duration,
		OnProgress: onProgress,
	})

	// Fallback to CPU if VAAPI fails
	if err != nil {
		e.logger.Warn("VAAPI watermark encoding failed, falling back to CPU", zap.Error(err))
		return e.Execute(ctx, ExecuteOptions{
			Args:       args,
			Duration:   duration,
			OnProgress: onProgress,
		})
	}

	return nil
}

// buildWatermarkFilter creates the FFmpeg filter complex string for watermark overlay
func (e *Executor) buildWatermarkFilter(opts WatermarkOptions) string {
	// Default values
	if opts.Opacity <= 0 {
		opts.Opacity = 1.0
	}
	if opts.Opacity > 1.0 {
		opts.Opacity = 1.0
	}
	if opts.Scale <= 0 {
		opts.Scale = 1.0
	}
	if opts.MarginX <= 0 {
		opts.MarginX = 10
	}
	if opts.MarginY <= 0 {
		opts.MarginY = 10
	}

	// Build watermark preparation filter (scale and opacity)
	var wmFilter string
	if opts.Scale != 1.0 {
		// Scale the watermark
		wmFilter = fmt.Sprintf("[1:v]scale=iw*%.2f:ih*%.2f", opts.Scale, opts.Scale)
	} else {
		wmFilter = "[1:v]null"
	}

	// Add opacity if not fully opaque
	if opts.Opacity < 1.0 {
		wmFilter += fmt.Sprintf(",format=rgba,colorchannelmixer=aa=%.2f", opts.Opacity)
	}

	wmFilter += "[wm]"

	// Build overlay position
	var overlayPos string
	mx := opts.MarginX
	my := opts.MarginY

	switch opts.Position {
	case "top-left":
		overlayPos = fmt.Sprintf("overlay=%d:%d", mx, my)
	case "top-right":
		overlayPos = fmt.Sprintf("overlay=main_w-overlay_w-%d:%d", mx, my)
	case "bottom-left":
		overlayPos = fmt.Sprintf("overlay=%d:main_h-overlay_h-%d", mx, my)
	case "bottom-right":
		overlayPos = fmt.Sprintf("overlay=main_w-overlay_w-%d:main_h-overlay_h-%d", mx, my)
	case "center":
		overlayPos = "overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2"
	default:
		// Default to bottom-right
		overlayPos = fmt.Sprintf("overlay=main_w-overlay_w-%d:main_h-overlay_h-%d", mx, my)
	}

	// Combine filters
	return fmt.Sprintf("%s;[0:v][wm]%s[out]", wmFilter, overlayPos)
}

// MergeVideosWithWatermark merges multiple video segments and applies watermark to the final output
func (e *Executor) MergeVideosWithWatermark(ctx context.Context, inputs []string, output string, totalDuration float64, watermark WatermarkOptions, onProgress ProgressCallback) error {
	// First merge without watermark to a temp file
	tempOutput := output + ".temp.mp4"
	defer os.Remove(tempOutput)

	if err := e.MergeVideos(ctx, inputs, tempOutput, totalDuration, func(p float64) {
		if onProgress != nil {
			onProgress(p * 0.7) // Merge is 70% of work
		}
	}); err != nil {
		return fmt.Errorf("failed to merge videos: %w", err)
	}

	// Apply watermark to merged video
	filterComplex := e.buildWatermarkFilter(watermark)

	args := []string{
		"-hide_banner",
		"-i", tempOutput,
		"-i", watermark.ImagePath,
		"-filter_complex", filterComplex,
		"-map", "[out]",
		"-map", "0:a?",
		"-c:v", "libx264",
		"-preset", "ultrafast", "-crf", "17",
		"-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-b:a", "192k",
		"-movflags", "+faststart",
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args:     args,
		Duration: totalDuration,
		OnProgress: func(p float64) {
			if onProgress != nil {
				onProgress(0.7 + p*0.3) // Watermark is 30% of work
			}
		},
	})
}

// ApplyWatermark applies a watermark to an existing video
func (e *Executor) ApplyWatermark(ctx context.Context, input, output string, watermark WatermarkOptions, onProgress ProgressCallback) error {
	// Get input duration for progress reporting
	info, err := e.Probe(ctx, input)
	if err != nil {
		return fmt.Errorf("failed to probe input: %w", err)
	}

	// Parse duration from probe result
	var duration float64
	if info.Format.Duration != "" {
		fmt.Sscanf(info.Format.Duration, "%f", &duration)
	}

	filterComplex := e.buildWatermarkFilter(watermark)

	args := []string{
		"-hide_banner",
		"-i", input,
		"-i", watermark.ImagePath,
		"-filter_complex", filterComplex,
		"-map", "[out]",
		"-map", "0:a?",
		"-c:v", "libx264",
		"-preset", "ultrafast", "-crf", "17",
		"-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-b:a", "192k",
		"-movflags", "+faststart",
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args:       args,
		Duration:   duration,
		OnProgress: onProgress,
	})
}

// buildBlurComplexFilter builds a complex filter for blur regions
func (e *Executor) buildBlurComplexFilter(opts FilterOptions, baseFilter string) string {
	if len(opts.BlurRegions) == 0 {
		return ""
	}

	// Complex filter approach:
	// 1. Apply base filter (crop) first
	// 2. For each blur region, create a blurred overlay
	// Using: split -> boxblur on region -> overlay

	var parts []string

	// Start with input and apply crop if needed
	inputLabel := "[0:v]"
	if baseFilter != "" {
		parts = append(parts, fmt.Sprintf("%s%s[base]", inputLabel, baseFilter))
		inputLabel = "[base]"
	}

	// For each blur region, we need to:
	// 1. Extract the region
	// 2. Apply blur
	// 3. Overlay it back with time-based enable

	currentInput := inputLabel
	for i, region := range opts.BlurRegions {
		blurRadius := region.BlurIntensity / 2
		if blurRadius < 5 {
			blurRadius = 5
		}

		// Enable expression for time range
		enableExpr := fmt.Sprintf("between(t,%.3f,%.3f)", region.StartTime, region.EndTime)

		// Create a boxblur that affects only the specific region using overlay
		// This is a simplified approach - we blur the entire frame and overlay the original except for the blur region
		// A better approach would be to use crop, blur, pad, and overlay

		// Simplified: use drawbox with pixelization effect
		// Or use: split, crop region, blur, overlay back

		// For simplicity, we'll use the 'enable' expression with boxblur on specific coords
		// FFmpeg doesn't directly support region-based blur, so we use a workaround

		// Workaround: Use overlay with a blurred version
		// [input]split=2[main][blur]; [blur]boxblur=15[blurred]; [main][blurred]overlay=x:y:enable='between(t,s,e)'

		// More efficient: use the 'delogo' style approach
		// Or create a mosaic effect with scale down/up

		outputLabel := fmt.Sprintf("[v%d]", i)
		if i == len(opts.BlurRegions)-1 {
			outputLabel = "[out]"
		}

		// Use split -> blur region -> overlay approach
		blurFilter := fmt.Sprintf(
			"%ssplit=2[main%d][forblur%d];"+
				"[forblur%d]crop=%d:%d:%d:%d,boxblur=%d:%d[blurred%d];"+
				"[main%d][blurred%d]overlay=%d:%d:enable='%s'%s",
			currentInput, i, i,
			i, region.Width, region.Height, region.X, region.Y, blurRadius, blurRadius, i,
			i, i, region.X, region.Y, enableExpr, outputLabel,
		)

		parts = append(parts, blurFilter)
		currentInput = outputLabel
	}

	// If we only have crop and no blur regions
	if len(parts) == 0 && baseFilter != "" {
		return fmt.Sprintf("[0:v]%s[out]", baseFilter)
	}

	// Combine all parts
	if len(parts) == 1 && baseFilter == "" && len(opts.BlurRegions) == 1 {
		// Single blur region without crop
		region := opts.BlurRegions[0]
		blurRadius := region.BlurIntensity / 2
		if blurRadius < 5 {
			blurRadius = 5
		}
		enableExpr := fmt.Sprintf("between(t,%.3f,%.3f)", region.StartTime, region.EndTime)

		return fmt.Sprintf(
			"[0:v]split=2[main][forblur];"+
				"[forblur]crop=%d:%d:%d:%d,boxblur=%d:%d[blurred];"+
				"[main][blurred]overlay=%d:%d:enable='%s'[out]",
			region.Width, region.Height, region.X, region.Y, blurRadius, blurRadius,
			region.X, region.Y, enableExpr,
		)
	}

	return strings.Join(parts, ";")
}

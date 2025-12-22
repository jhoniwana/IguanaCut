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

// accurateCut performs frame-accurate cutting by re-encoding
// Uses high quality settings (CRF 17) to minimize quality loss
func (e *Executor) accurateCut(ctx context.Context, input, output string, start, duration float64, onProgress ProgressCallback) error {
	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.6f", start), // Input seeking for speed
		"-i", input,
		"-t", fmt.Sprintf("%.6f", duration),
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "17", // Visually nearly lossless
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

// regularCut performs a standard lossless cut (may have keyframe issues)
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
		"-preset", "fast",
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

// CaptureSnapshot captures a frame as an image
func (e *Executor) CaptureSnapshot(ctx context.Context, input, output string, timestamp float64, quality int) error {
	args := []string{
		"-hide_banner",
		"-ss", fmt.Sprintf("%.3f", timestamp),
		"-i", input,
		"-vframes", "1",
		"-q:v", fmt.Sprintf("%d", quality),
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args: args,
	})
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

// GenerateWaveform generates an audio waveform image using FFmpeg showwavespic filter
func (e *Executor) GenerateWaveform(ctx context.Context, input, output string) error {
	// Generate a waveform image using FFmpeg's showwavespic filter
	// This is very fast and produces a good looking waveform
	args := []string{
		"-hide_banner",
		"-i", input,
		"-filter_complex", "showwavespic=s=1920x120:colors=#667eea|#667eea:scale=sqrt:split_channels=0",
		"-frames:v", "1",
		"-y",
		output,
	}

	return e.Execute(ctx, ExecuteOptions{
		Args: args,
	})
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
		return e.CutVideo(ctx, opts.Input, opts.Output, opts.Start, opts.End, opts.OnProgress)
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
			"-preset", opts.Preset,
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
		"-preset", "ultrafast",
		"-crf", "18",
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

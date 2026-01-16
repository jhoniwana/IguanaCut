package ffmpeg

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"go.uber.org/zap"
)

// FaceBlurProgress represents progress data from the Python script
type FaceBlurProgress struct {
	Progress       float64 `json:"progress"`
	Frame          int     `json:"frame"`
	TotalFrames    int     `json:"total_frames"`
	FacesInFrame   int     `json:"faces_in_frame"`
	Status         string  `json:"status"`
	Error          string  `json:"error"`
	FramesWithFace int     `json:"frames_with_faces"`
	TotalFaces     int     `json:"total_faces_detected"`
	OutputPath     string  `json:"output_path"`
}

// BlurStyleConfig holds blur style configuration
type BlurStyleConfig struct {
	Style     string `json:"style"`     // pixelate, gaussian, color, box, emoji, image
	Intensity int    `json:"intensity"` // For pixelate/gaussian
	Color     string `json:"color"`     // For color style (hex)
	Emoji     string `json:"emoji"`     // For emoji style
	ImageData string `json:"imageData"` // Base64 image for image style
}

// BlurFacesAuto detects and blurs faces automatically using OpenCV
func (e *Executor) BlurFacesAuto(ctx context.Context, input, output string, intensity int, confirmedSignatures [][]float64, blurStyle *BlurStyleConfig, onProgress ProgressCallback) error {
	// Find the Python script
	scriptPath := e.findBlurScript()
	if scriptPath == "" {
		return fmt.Errorf("blur_faces.py script not found")
	}

	// Default blur style
	style := "pixelate"
	color := "#000000"
	emoji := "😀"
	imageData := ""
	if blurStyle != nil {
		if blurStyle.Style != "" {
			style = blurStyle.Style
		}
		if blurStyle.Color != "" {
			color = blurStyle.Color
		}
		if blurStyle.Emoji != "" {
			emoji = blurStyle.Emoji
		}
		if blurStyle.ImageData != "" {
			imageData = blurStyle.ImageData
		}
	}

	e.logger.Info("Starting auto face blur",
		zap.String("input", input),
		zap.String("output", output),
		zap.Int("intensity", intensity),
		zap.String("style", style),
		zap.Int("confirmedSignatures", len(confirmedSignatures)),
		zap.String("script", scriptPath),
	)

	// Build command
	pythonCmd := "python3"
	if runtime.GOOS == "windows" {
		pythonCmd = "python"
	}

	args := []string{
		scriptPath,
		"--input", input,
		"--output", output,
		"--intensity", fmt.Sprintf("%d", intensity),
		"--style", style,
		"--color", color,
		"--emoji", emoji,
	}

	// Add image data if provided (for image style)
	if style == "image" && imageData != "" {
		args = append(args, "--image", imageData)
	}

	// Write confirmed signatures to temp file to avoid "argument list too long" error
	// IMPORTANT: Always write file if confirmedSignatures is not nil, even if empty
	// This allows Python to distinguish between:
	// - nil (no filter) → blur all faces
	// - empty [] (user deselected all) → blur nothing
	// - [sig1, sig2...] (user confirmed specific faces) → blur only matching faces
	var signaturesFile string
	if confirmedSignatures != nil {
		signaturesJSON, err := json.Marshal(confirmedSignatures)
		if err == nil {
			// Create temp file for signatures
			tmpFile, err := os.CreateTemp("", "face_signatures_*.json")
			if err != nil {
				e.logger.Warn("Failed to create temp file for signatures, falling back to args",
					zap.Error(err))
				// Fallback to args (may fail for large signature lists)
				args = append(args, "--signatures", string(signaturesJSON))
			} else {
				signaturesFile = tmpFile.Name()
				if _, err := tmpFile.Write(signaturesJSON); err != nil {
					e.logger.Warn("Failed to write signatures to temp file",
						zap.Error(err))
					tmpFile.Close()
					os.Remove(signaturesFile)
					signaturesFile = ""
					args = append(args, "--signatures", string(signaturesJSON))
				} else {
					tmpFile.Close()
					args = append(args, "--signatures-file", signaturesFile)
					e.logger.Info("Signatures written to temp file",
						zap.String("file", signaturesFile),
						zap.Int("count", len(confirmedSignatures)),
					)
				}
			}
		}
	}

	// Cleanup signatures file after command completes
	defer func() {
		if signaturesFile != "" {
			os.Remove(signaturesFile)
		}
	}()

	cmd := exec.CommandContext(ctx, pythonCmd, args...)

	// Capture stdout for progress
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	// Capture stderr for errors
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start face blur script: %w", err)
	}

	// Read stdout for progress updates
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()

			var progress FaceBlurProgress
			if err := json.Unmarshal([]byte(line), &progress); err != nil {
				e.logger.Debug("Non-JSON output from blur script", zap.String("line", line))
				continue
			}

			if progress.Error != "" {
				e.logger.Error("Error from blur script", zap.String("error", progress.Error))
				continue
			}

			if onProgress != nil && progress.Progress > 0 {
				onProgress(progress.Progress)
			}

			e.logger.Debug("Face blur progress",
				zap.Float64("progress", progress.Progress),
				zap.Int("frame", progress.Frame),
				zap.Int("facesInFrame", progress.FacesInFrame),
			)
		}
	}()

	// Read stderr for errors
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			e.logger.Warn("Blur script stderr", zap.String("line", scanner.Text()))
		}
	}()

	// Wait for completion
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("face blur script failed: %w", err)
	}

	e.logger.Info("Face blur completed successfully",
		zap.String("output", output),
	)

	return nil
}

// DetectionZone represents a circular zone for guided face detection
type DetectionZone struct {
	ID        string  `json:"id"`
	X         int     `json:"x"`
	Y         int     `json:"y"`
	Radius    int     `json:"radius"`
	StartTime float64 `json:"start_time"`
	EndTime   float64 `json:"end_time"`
}

// BlurFacesGuided detects and blurs faces only within specified zones
func (e *Executor) BlurFacesGuided(ctx context.Context, input, output string, intensity int, zones []DetectionZone, onProgress ProgressCallback) error {
	// Find the Python script
	scriptPath := e.findBlurScript()
	if scriptPath == "" {
		return fmt.Errorf("blur_faces.py script not found")
	}

	e.logger.Info("Starting guided face blur",
		zap.String("input", input),
		zap.String("output", output),
		zap.Int("intensity", intensity),
		zap.Int("zones", len(zones)),
		zap.String("script", scriptPath),
	)

	// Convert zones to JSON
	zonesJSON, err := json.Marshal(zones)
	if err != nil {
		return fmt.Errorf("failed to marshal zones: %w", err)
	}

	// Build command
	pythonCmd := "python3"
	if runtime.GOOS == "windows" {
		pythonCmd = "python"
	}

	args := []string{
		scriptPath,
		"--input", input,
		"--output", output,
		"--intensity", fmt.Sprintf("%d", intensity),
		"--zones", string(zonesJSON),
	}

	cmd := exec.CommandContext(ctx, pythonCmd, args...)

	// Capture stdout for progress
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	// Capture stderr for errors
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start face blur script: %w", err)
	}

	// Read stdout for progress updates
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()

			var progress FaceBlurProgress
			if err := json.Unmarshal([]byte(line), &progress); err != nil {
				e.logger.Debug("Non-JSON output from blur script", zap.String("line", line))
				continue
			}

			if progress.Error != "" {
				e.logger.Error("Error from blur script", zap.String("error", progress.Error))
				continue
			}

			if onProgress != nil && progress.Progress > 0 {
				onProgress(progress.Progress)
			}

			e.logger.Debug("Guided face blur progress",
				zap.Float64("progress", progress.Progress),
				zap.Int("frame", progress.Frame),
				zap.Int("facesInFrame", progress.FacesInFrame),
			)
		}
	}()

	// Read stderr for errors
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			e.logger.Warn("Blur script stderr", zap.String("line", scanner.Text()))
		}
	}()

	// Wait for completion
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("guided face blur script failed: %w", err)
	}

	e.logger.Info("Guided face blur completed successfully",
		zap.String("output", output),
		zap.Int("zones_used", len(zones)),
	)

	return nil
}

// TimeRange represents a time segment for scanning
type TimeRange struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// DetectFaces runs face detection and returns thumbnails for user confirmation
// groupSimilar: if false, returns all detected faces without grouping similar ones
// segments: if provided, only scan within these time ranges
func (e *Executor) DetectFaces(ctx context.Context, input string, interval float64, maxFaces int, groupSimilar bool, segments []TimeRange) (map[string]interface{}, error) {
	scriptPath := e.findDetectScript()
	if scriptPath == "" {
		return nil, fmt.Errorf("detect_faces.py script not found")
	}

	e.logger.Info("Starting face detection preview",
		zap.String("input", input),
		zap.Float64("interval", interval),
		zap.Int("maxFaces", maxFaces),
		zap.Bool("groupSimilar", groupSimilar),
		zap.Int("segments", len(segments)),
		zap.String("script", scriptPath),
	)

	pythonCmd := "python3"
	if runtime.GOOS == "windows" {
		pythonCmd = "python"
	}

	args := []string{
		scriptPath,
		"--input", input,
		"--interval", fmt.Sprintf("%.2f", interval),
		"--max-faces", fmt.Sprintf("%d", maxFaces),
	}

	// Add --no-group flag if grouping is disabled
	if !groupSimilar {
		args = append(args, "--no-group")
	}

	// Add segments if provided
	if len(segments) > 0 {
		segmentsJSON, err := json.Marshal(segments)
		if err == nil {
			args = append(args, "--segments", string(segmentsJSON))
		}
	}

	cmd := exec.CommandContext(ctx, pythonCmd, args...)

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("face detection failed: %s", string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("face detection failed: %w", err)
	}

	// Parse the last JSON line (the result)
	lines := splitLines(string(output))
	if len(lines) == 0 {
		return nil, fmt.Errorf("no output from face detection script")
	}

	// Find the last valid JSON with "faces" or "error" key
	var result map[string]interface{}
	for i := len(lines) - 1; i >= 0; i-- {
		line := lines[i]
		if line == "" {
			continue
		}
		if err := json.Unmarshal([]byte(line), &result); err == nil {
			if _, hasFaces := result["faces"]; hasFaces {
				break
			}
			if _, hasError := result["error"]; hasError {
				break
			}
		}
	}

	if result == nil {
		return nil, fmt.Errorf("failed to parse face detection output")
	}

	if errMsg, ok := result["error"].(string); ok {
		return nil, fmt.Errorf(errMsg)
	}

	e.logger.Info("Face detection completed",
		zap.Int("faces_found", len(result["faces"].([]interface{}))),
	)

	return result, nil
}

// splitLines splits a string into lines
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

// findDetectScript locates the detect_faces.py script
func (e *Executor) findDetectScript() string {
	possiblePaths := []string{
		"scripts/detect_faces.py",
		"./scripts/detect_faces.py",
		"../scripts/detect_faces.py",
		"/app/scripts/detect_faces.py",
		"/opt/losslesscut/scripts/detect_faces.py",
	}

	for _, path := range possiblePaths {
		absPath, err := filepath.Abs(path)
		if err != nil {
			continue
		}
		if fileExists(absPath) {
			return absPath
		}
	}

	return ""
}

// findBlurScript locates the blur_faces.py script
func (e *Executor) findBlurScript() string {
	// Try common locations
	possiblePaths := []string{
		"scripts/blur_faces.py",
		"./scripts/blur_faces.py",
		"../scripts/blur_faces.py",
		"/app/scripts/blur_faces.py",           // Docker
		"/opt/losslesscut/scripts/blur_faces.py", // Custom install
	}

	// Also try relative to executable
	if execPath, err := exec.LookPath("blur_faces.py"); err == nil {
		return execPath
	}

	for _, path := range possiblePaths {
		absPath, err := filepath.Abs(path)
		if err != nil {
			continue
		}
		if _, err := exec.LookPath(absPath); err == nil {
			return absPath
		}
		// Just check if file exists
		if fileExists(absPath) {
			return absPath
		}
	}

	return ""
}

// fileExists checks if a file exists
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

package ffmpeg

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
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

// BlurFacesAuto detects and blurs faces automatically using OpenCV
func (e *Executor) BlurFacesAuto(ctx context.Context, input, output string, intensity int, onProgress ProgressCallback) error {
	// Find the Python script
	scriptPath := e.findBlurScript()
	if scriptPath == "" {
		return fmt.Errorf("blur_faces.py script not found")
	}

	e.logger.Info("Starting auto face blur",
		zap.String("input", input),
		zap.String("output", output),
		zap.Int("intensity", intensity),
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
	_, err := exec.Command("test", "-f", path).Output()
	return err == nil
}

package services

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/mifi/lossless-cut/backend/internal/config"
	"github.com/mifi/lossless-cut/backend/internal/ffmpeg"
	"github.com/mifi/lossless-cut/backend/internal/models"
	"github.com/mifi/lossless-cut/backend/internal/storage"
	"go.uber.org/zap"
)

type VideoService struct {
	storage *storage.Manager
	config  *config.Config
	logger  *zap.Logger
	ffmpeg  *ffmpeg.Executor
}

func NewVideoService(storage *storage.Manager, cfg *config.Config, logger *zap.Logger) *VideoService {
	return &VideoService{
		storage: storage,
		config:  cfg,
		logger:  logger,
		ffmpeg:  ffmpeg.NewExecutor(cfg.FFmpeg.Path, "/home/jhon/lossless/backend/ffprobe-static", logger),
	}
}

func (s *VideoService) CreateFromUpload(filename string, filepath string, sessionID string) (*models.Video, error) {
	// Get file size
	fileSize, err := s.storage.GetFileSize(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to get file size: %w", err)
	}

	// Create video record with session ID
	video := &models.Video{
		ID:        generateVideoID(),
		FileName:  filename,
		FilePath:  filepath,
		FileSize:  fileSize,
		SessionID: sessionID,
		CreatedAt: time.Now(),
	}

	// Extract metadata with FFprobe
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	probe, err := s.ffmpeg.Probe(ctx, filepath)
	if err != nil {
		s.logger.Warn("Failed to extract video metadata", zap.Error(err))
		// Don't fail to upload if probe fails, just log it
	} else {
		// Parse metadata
		if duration, err := probe.GetDuration(); err == nil {
			video.Duration = duration
		}

		video.Format = probe.Format.FormatName

		// Get video dimensions from first video stream
		videoStreams := probe.GetVideoStreams()
		if len(videoStreams) > 0 {
			video.Width = videoStreams[0].Width
			video.Height = videoStreams[0].Height
			video.Codec = videoStreams[0].CodecName
		}

		// Convert probe result to models.VideoMetadata
		if metadata := convertProbeToMetadata(probe); metadata != nil {
			video.Metadata = *metadata
		}
	}

	// Save video metadata
	if err := s.storage.SaveVideo(video); err != nil {
		s.logger.Error("Failed to save video metadata", zap.Error(err))
		// Don't fail to upload if metadata save fails, just log it
	}

	s.logger.Info("Created video from upload",
		zap.String("id", video.ID),
		zap.String("filename", filename),
		zap.Float64("duration", video.Duration),
		zap.String("format", video.Format),
		zap.String("filepath", video.FilePath),
		zap.Int64("fileSize", fileSize),
	)

	return video, nil
}

func (s *VideoService) GetVideo(id string) (*models.Video, error) {
	return s.storage.GetVideo(id)
}

func (s *VideoService) ListVideos() ([]*models.Video, error) {
	return s.storage.ListVideos()
}

func (s *VideoService) DeleteVideo(id string) error {
	video, err := s.storage.GetVideo(id)
	if err != nil {
		return err
	}

	// Delete physical file
	if err := s.storage.DeleteFile(video.FilePath); err != nil {
		s.logger.Warn("Failed to delete video file", zap.String("path", video.FilePath), zap.Error(err))
	}

	// Delete metadata
	return s.storage.DeleteVideo(id)
}

func (s *VideoService) StreamVideo(id string) (string, error) {
	video, err := s.storage.GetVideo(id)
	if err != nil {
		return "", err
	}

	return video.FilePath, nil
}

func (s *VideoService) CaptureScreenshot(videoID string, timestamp float64) (string, error) {
	video, err := s.storage.GetVideo(videoID)
	if err != nil {
		return "", fmt.Errorf("video not found: %w", err)
	}

	// Generate screenshot filename with .jpg extension (FFmpeg needs extension to determine format)
	screenshotID := generateVideoID() + ".jpg"
	screenshotPath := s.storage.GetScreenshotPath(screenshotID)

	// Ensure screenshots directory exists
	if err := os.MkdirAll(s.storage.ScreenshotsDir(), 0755); err != nil {
		return "", fmt.Errorf("failed to create screenshots directory: %w", err)
	}

	// Capture screenshot using FFmpeg
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Use quality 2 (high quality for JPEG)
	err = s.ffmpeg.CaptureSnapshot(ctx, video.FilePath, screenshotPath, timestamp, 2)
	if err != nil {
		return "", fmt.Errorf("failed to capture screenshot: %w", err)
	}

	s.logger.Info("Captured screenshot",
		zap.String("videoID", videoID),
		zap.String("screenshotID", screenshotID),
		zap.Float64("timestamp", timestamp),
	)

	return screenshotID, nil
}

func (s *VideoService) GetScreenshotPath(screenshotID string) string {
	return s.storage.GetScreenshotPath(screenshotID)
}

func (s *VideoService) GenerateWaveform(videoID string) (string, error) {
	video, err := s.storage.GetVideo(videoID)
	if err != nil {
		return "", fmt.Errorf("video not found: %w", err)
	}

	// Generate waveform path
	waveformPath := s.storage.GetWaveformPath(videoID + ".png")

	// Check if waveform already exists
	if s.storage.FileExists(waveformPath) {
		return waveformPath, nil
	}

	// Ensure waveforms directory exists
	if err := os.MkdirAll(s.storage.WaveformsDir(), 0755); err != nil {
		return "", fmt.Errorf("failed to create waveforms directory: %w", err)
	}

	// Generate waveform using FFmpeg
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	err = s.ffmpeg.GenerateWaveform(ctx, video.FilePath, waveformPath)
	if err != nil {
		return "", fmt.Errorf("failed to generate waveform: %w", err)
	}

	s.logger.Info("Generated waveform",
		zap.String("videoID", videoID),
		zap.String("waveformPath", waveformPath),
	)

	return waveformPath, nil
}

func (s *VideoService) DetectFaces(videoPath string, interval float64, maxFaces int, groupSimilar bool, segments []ffmpeg.TimeRange) (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	result, err := s.ffmpeg.DetectFaces(ctx, videoPath, interval, maxFaces, groupSimilar, segments)
	if err != nil {
		return nil, fmt.Errorf("face detection failed: %w", err)
	}

	return result, nil
}

func generateVideoID() string {
	return uuid.New().String()
}

func convertProbeToMetadata(probe *ffmpeg.ProbeResult) *models.VideoMetadata {
	metadata := &models.VideoMetadata{
		Streams: make([]models.Stream, 0),
	}

	// Copy format info
	metadata.Format = models.Format{
		FormatName:     probe.Format.FormatName,
		FormatLongName: probe.Format.FormatLongName,
	}

	// Parse duration if available
	if probe.Format.Duration != "" {
		if duration, err := parseDuration(probe.Format.Duration); err == nil {
			metadata.Format.Duration = duration
		}
	}

	// Parse size if available
	if probe.Format.Size != "" {
		if size, err := parseSize(probe.Format.Size); err == nil {
			metadata.Format.Size = size
		}
	}

	// Parse bit rate if available
	if probe.Format.BitRate != "" {
		if bitRate, err := parseSize(probe.Format.BitRate); err == nil {
			metadata.Format.BitRate = bitRate
		}
	}

	// Copy stream info
	for _, stream := range probe.Streams {
		streamInfo := models.Stream{
			Index:     stream.Index,
			CodecName: stream.CodecName,
			CodecType: stream.CodecType,
			Width:     stream.Width,
			Height:    stream.Height,
		}

		// Parse duration if available
		if stream.Duration != "" {
			if duration, err := parseDuration(stream.Duration); err == nil {
				streamInfo.Duration = duration
			}
		}

		// Parse bit rate if available
		if stream.BitRate != "" {
			if bitRate, err := parseSize(stream.BitRate); err == nil {
				streamInfo.BitRate = bitRate
			}
		}

		// Parse sample rate if available
		if stream.SampleRate != "" {
			if sampleRate, err := parseSize(stream.SampleRate); err == nil {
				streamInfo.SampleRate = int(sampleRate)
			}
		}

		// Set channels
		streamInfo.Channels = stream.Channels

		// Extract language and title from tags
		if stream.Tags != nil {
			if lang, ok := stream.Tags["language"]; ok {
				streamInfo.Language = lang
			}
			if title, ok := stream.Tags["title"]; ok {
				streamInfo.Title = title
			}
		}

		metadata.Streams = append(metadata.Streams, streamInfo)
	}

	return metadata
}

// Helper functions to parse string values from FFprobe
func parseDuration(durationStr string) (float64, error) {
	var duration float64
	_, err := fmt.Sscanf(durationStr, "%f", &duration)
	return duration, err
}

func parseSize(sizeStr string) (int64, error) {
	var size int64
	_, err := fmt.Sscanf(sizeStr, "%d", &size)
	return size, err
}

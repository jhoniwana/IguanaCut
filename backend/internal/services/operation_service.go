package services

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/mifi/lossless-cut/backend/internal/config"
	"github.com/mifi/lossless-cut/backend/internal/ffmpeg"
	"github.com/mifi/lossless-cut/backend/internal/models"
	"github.com/mifi/lossless-cut/backend/internal/storage"
	"go.uber.org/zap"
)

type OperationService struct {
	storage    *storage.Manager
	config     *config.Config
	logger     *zap.Logger
	ffmpeg     *ffmpeg.Executor
	operations map[string]*models.Operation
	mu         sync.RWMutex
}

func NewOperationService(storage *storage.Manager, cfg *config.Config, logger *zap.Logger) *OperationService {
	return &OperationService{
		storage:    storage,
		config:     cfg,
		logger:     logger,
		ffmpeg:     ffmpeg.NewExecutor(cfg.FFmpeg.Path, cfg.FFmpeg.FFprobePath, logger),
		operations: make(map[string]*models.Operation),
	}
}

func (s *OperationService) Export(project *models.Project, request models.ExportRequest) (*models.Operation, error) {
	operation := &models.Operation{
		ID:        uuid.New().String(),
		Type:      models.OperationTypeExport,
		ProjectID: project.ID,
		Status:    models.OperationStatusPending,
		Progress:  0,
		CreatedAt: time.Now(),
	}

	// Store operation
	s.mu.Lock()
	s.operations[operation.ID] = operation
	s.mu.Unlock()

	// Run export in background
	go s.runExport(operation, project, request)

	return operation, nil
}

func (s *OperationService) runExport(operation *models.Operation, project *models.Project, request models.ExportRequest) {
	operation.Status = models.OperationStatusProcessing
	operation.Progress = 5 // Initial progress to show activity
	ctx := context.Background()

	// Get actual video file path from metadata
	video, err := s.storage.GetVideo(project.VideoID)
	if err != nil {
		operation.Status = models.OperationStatusFailed
		operation.Error = fmt.Sprintf("video not found: %v", err)
		s.logger.Error("Failed to get video for export",
			zap.String("videoId", project.VideoID),
			zap.Error(err),
		)
		return
	}

	inputPath := video.FilePath
	s.logger.Info("Starting export",
		zap.String("operationId", operation.ID),
		zap.String("inputPath", inputPath),
		zap.String("videoId", project.VideoID),
		zap.Bool("mergeSegments", request.MergeSegments),
		zap.Bool("exportSeparate", request.ExportSeparate),
		zap.String("introImagePath", request.IntroImagePath),
		zap.Int("introDuration", request.IntroDuration),
		zap.String("outroImagePath", request.OutroImagePath),
		zap.Int("outroDuration", request.OutroDuration),
	)

	// Determine segments to export
	segments := project.Segments
	if len(request.SegmentIDs) > 0 {
		// Filter to specified segments
		filteredSegments := []models.Segment{}
		for _, seg := range project.Segments {
			for _, id := range request.SegmentIDs {
				if seg.ID == id {
					filteredSegments = append(filteredSegments, seg)
					break
				}
			}
		}
		segments = filteredSegments
	}

	// Log segment details for debugging
	for i, seg := range segments {
		endVal := "nil"
		if seg.End != nil {
			endVal = fmt.Sprintf("%.3f", *seg.End)
		}
		s.logger.Info("Segment to export",
			zap.Int("index", i),
			zap.String("id", seg.ID),
			zap.String("name", seg.Name),
			zap.Float64("start", seg.Start),
			zap.String("end", endVal),
		)
	}

	if len(segments) == 0 {
		operation.Status = models.OperationStatusFailed
		operation.Error = "no segments to export"
		return
	}

	// Build output filename
	outputName := request.OutputName
	if outputName == "" {
		outputName = fmt.Sprintf("%s_export_%d", project.Name, time.Now().Unix())
	}

	format := request.Format
	if format == "" {
		format = "mp4"
	}

	// Progress callback with minimum step of 10%
	operation.Progress = 10 // Started processing
	onProgress := func(progress float64) {
		// Scale progress from 10% to 95% (leave 5% for finalization)
		scaledProgress := 10 + (progress * 85)
		if scaledProgress > operation.Progress {
			operation.Progress = scaledProgress
		}
		s.logger.Debug("Export progress",
			zap.String("operationId", operation.ID),
			zap.Float64("rawProgress", progress),
			zap.Float64("scaledProgress", operation.Progress),
		)
	}

	var outputFiles []string
	var exportErr error

	// Ensure outputs directory exists
	if err := os.MkdirAll(s.storage.OutputsDir(), 0755); err != nil {
		operation.Status = models.OperationStatusFailed
		operation.Error = fmt.Sprintf("failed to create outputs directory: %v", err)
		s.logger.Error("Failed to create outputs directory", zap.Error(err))
		return
	}

	// Handle intro/outro videos
	var introPath, outroPath string
	var tempFiles []string

	if request.IntroImagePath != "" && request.IntroDuration > 0 {
		introPath = s.storage.GetOutputPath(fmt.Sprintf("temp_intro_%s_%d.mp4", project.ID, time.Now().Unix()))
		err := s.ffmpeg.CreateIntroVideo(ctx, request.IntroImagePath, request.IntroDuration, introPath, func(progress float64) {
			onProgress(progress * 0.1) // 10% of total progress
		})
		if err != nil {
			operation.Status = models.OperationStatusFailed
			operation.Error = fmt.Sprintf("failed to create intro: %v", err)
			return
		}
		tempFiles = append(tempFiles, introPath)
	}

	if request.OutroImagePath != "" && request.OutroDuration > 0 {
		outroPath = s.storage.GetOutputPath(fmt.Sprintf("temp_outro_%s_%d.mp4", project.ID, time.Now().Unix()))
		err := s.ffmpeg.CreateIntroVideo(ctx, request.OutroImagePath, request.OutroDuration, outroPath, func(progress float64) {
			onProgress(0.1 + (progress * 0.1)) // 10-20% of total progress
		})
		if err != nil {
			operation.Status = models.OperationStatusFailed
			operation.Error = fmt.Sprintf("failed to create outro: %v", err)
			return
		}
		tempFiles = append(tempFiles, outroPath)
	}

	// Handle different export modes
	if len(segments) == 1 {
		// Single segment - just cut it
		outputPath := s.storage.GetOutputPath(fmt.Sprintf("%s.%s", outputName, format))
		seg := segments[0]
		if seg.End == nil {
			operation.Status = models.OperationStatusFailed
			operation.Error = "segment has no end time defined"
			s.logger.Error("Single segment has nil End value", zap.String("id", seg.ID))
			return
		}
		end := *seg.End

		// Check if blur is enabled for this specific clip
		blurEnabledForClip := true
		if request.BlurPerClip != nil {
			if enabled, exists := request.BlurPerClip[seg.ID]; exists {
				blurEnabledForClip = enabled
			}
		}

		s.logger.Info("Exporting single segment",
			zap.String("segmentId", seg.ID),
			zap.Float64("start", seg.Start),
			zap.Float64("end", end),
			zap.Float64("duration", end-seg.Start),
			zap.Bool("hasFilters", s.hasFilters(request)),
			zap.Bool("blurEnabled", blurEnabledForClip),
		)

		// Create a modified request for this segment
		segRequest := request
		if !blurEnabledForClip {
			// Disable blur for this segment
			segRequest.BlurMode = "off"
		}

		exportErr = s.cutVideoWithOptionalFilters(ctx, inputPath, outputPath, seg.Start, end, segRequest, onProgress)
		if exportErr == nil {
			outputFiles = append(outputFiles, outputPath)
		}
	} else {
		// Multiple segments
		if request.MergeSegments {
			// Export merged file - cut segments first then merge
			mergedPath := s.storage.GetOutputPath(fmt.Sprintf("%s_merged.%s", outputName, format))
			exportErr = s.exportMergedSegments(ctx, inputPath, mergedPath, segments, request, onProgress)
			if exportErr == nil {
				outputFiles = append(outputFiles, mergedPath)
			}
		}

		if request.ExportSeparate && exportErr == nil {
			// Export each segment separately
			separateFiles, err := s.exportMultipleSegments(ctx, inputPath, outputName, format, segments, request, onProgress)
			if err != nil {
				exportErr = err
			} else {
				outputFiles = append(outputFiles, separateFiles...)
			}
		}

		// Handle chapters export
		if request.ExportChapters && exportErr == nil {
			chaptersPath := s.storage.GetOutputPath(fmt.Sprintf("%s_chapters.%s", outputName, request.ChaptersFormat))
			err := s.exportChapters(ctx, chaptersPath, segments)
			if err != nil {
				exportErr = err
			} else {
				outputFiles = append(outputFiles, chaptersPath)
			}
		}

		// If neither merge nor separate was specified, default to merge
		if !request.MergeSegments && !request.ExportSeparate && !request.ExportChapters {
			mergedPath := s.storage.GetOutputPath(fmt.Sprintf("%s.%s", outputName, format))
			exportErr = s.exportMergedSegments(ctx, inputPath, mergedPath, segments, request, onProgress)
			if exportErr == nil {
				outputFiles = append(outputFiles, mergedPath)
			}
		}
	}

	if exportErr != nil {
		operation.Status = models.OperationStatusFailed
		operation.Error = exportErr.Error()
		s.logger.Error("Export failed",
			zap.String("operationId", operation.ID),
			zap.Error(exportErr),
		)
		return
	}

	// Cleanup temp files
	for _, tempFile := range tempFiles {
		if err := os.Remove(tempFile); err != nil {
			s.logger.Warn("Failed to cleanup temp file",
				zap.String("file", tempFile),
				zap.Error(err))
		}
	}

	// Success
	now := time.Now()
	operation.Status = models.OperationStatusCompleted
	operation.Progress = 100
	operation.CompletedAt = &now
	operation.OutputFiles = outputFiles

	// Vincular cada corte exportado con su video de origen (indice persistido)
	for _, f := range outputFiles {
		if err := s.storage.RegisterOutput(filepath.Base(f), project.VideoID); err != nil {
			s.logger.Warn("Failed to index output", zap.String("file", f), zap.Error(err))
		}
	}

	s.logger.Info("Export completed",
		zap.String("operationId", operation.ID),
		zap.Int("outputFilesCount", len(outputFiles)),
		zap.Strings("outputFiles", outputFiles),
	)
}

func (s *OperationService) exportMergedSegments(ctx context.Context, inputPath, outputPath string, segments []models.Segment, request models.ExportRequest, onProgress ffmpeg.ProgressCallback) error {
	// Ensure temp directory exists
	if err := os.MkdirAll(s.storage.TempDir(), 0755); err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	// Cut each segment to temp files
	tempFiles := make([]string, len(segments))

	// Calculate total duration first for progress reporting
	totalDuration := 0.0
	for i, seg := range segments {
		if seg.End == nil {
			s.logger.Error("Segment has nil End value",
				zap.Int("index", i),
				zap.String("id", seg.ID),
				zap.Float64("start", seg.Start),
			)
			return fmt.Errorf("segment %d (%s) has no end time defined", i, seg.ID)
		}
		segDuration := *seg.End - seg.Start
		s.logger.Info("Segment duration",
			zap.Int("index", i),
			zap.Float64("start", seg.Start),
			zap.Float64("end", *seg.End),
			zap.Float64("duration", segDuration),
		)
		totalDuration += segDuration
	}
	s.logger.Info("Total expected duration", zap.Float64("totalDuration", totalDuration))

	for i, seg := range segments {
		tempFile := s.storage.GetTempPath(fmt.Sprintf("segment_%d_%s.mp4", i, uuid.New().String()))
		tempFiles[i] = tempFile

		end := *seg.End // Already validated above

		// Check if blur is enabled for this specific clip
		blurEnabledForClip := true
		if request.BlurPerClip != nil {
			if enabled, exists := request.BlurPerClip[seg.ID]; exists {
				blurEnabledForClip = enabled
			}
		}

		s.logger.Info("Cutting segment",
			zap.Int("index", i),
			zap.String("segmentId", seg.ID),
			zap.Float64("start", seg.Start),
			zap.Float64("end", end),
			zap.String("tempFile", tempFile),
			zap.Bool("hasFilters", s.hasFilters(request)),
			zap.Bool("blurEnabled", blurEnabledForClip),
		)

		// Create a modified request for this segment
		segRequest := request
		if !blurEnabledForClip {
			// Disable blur for this segment
			segRequest.BlurMode = "off"
		}

		// Cut segment with optional filters (no progress callback for individual segments)
		if err := s.cutVideoWithOptionalFilters(ctx, inputPath, tempFile, seg.Start, end, segRequest, nil); err != nil {
			return fmt.Errorf("failed to cut segment %d: %w", i, err)
		}
	}

	if err := s.ffmpeg.MergeVideos(ctx, tempFiles, outputPath, totalDuration, onProgress); err != nil {
		return fmt.Errorf("failed to merge segments: %w", err)
	}

	// Clean up temp files
	for _, tempFile := range tempFiles {
		s.storage.DeleteFile(tempFile)
	}

	return nil
}

func (s *OperationService) exportMultipleSegments(ctx context.Context, inputPath, outputBaseName, format string, segments []models.Segment, request models.ExportRequest, onProgress ffmpeg.ProgressCallback) ([]string, error) {
	var outputFiles []string

	for i, seg := range segments {
		segmentName := fmt.Sprintf("%s_segment_%d.%s", outputBaseName, i+1, format)
		outputPath := s.storage.GetOutputPath(segmentName)

		if seg.End == nil {
			return outputFiles, fmt.Errorf("segment %d (%s) has no end time defined", i, seg.ID)
		}
		end := *seg.End

		// Check if blur is enabled for this specific clip
		blurEnabledForClip := true
		if request.BlurPerClip != nil {
			if enabled, exists := request.BlurPerClip[seg.ID]; exists {
				blurEnabledForClip = enabled
			}
		}

		s.logger.Info("Exporting separate segment",
			zap.Int("index", i),
			zap.String("segmentId", seg.ID),
			zap.Float64("start", seg.Start),
			zap.Float64("end", end),
			zap.Float64("duration", end-seg.Start),
			zap.Bool("hasFilters", s.hasFilters(request)),
			zap.Bool("blurEnabled", blurEnabledForClip),
		)

		// Create a modified request for this segment
		segRequest := request
		if !blurEnabledForClip {
			// Disable blur for this segment
			segRequest.BlurMode = "off"
		}

		if err := s.cutVideoWithOptionalFilters(ctx, inputPath, outputPath, seg.Start, end, segRequest, onProgress); err != nil {
			return outputFiles, fmt.Errorf("failed to export segment %d: %w", i, err)
		}

		outputFiles = append(outputFiles, outputPath)
	}

	return outputFiles, nil
}

// exportChapters exports segments as chapter file
func (s *OperationService) exportChapters(ctx context.Context, outputPath string, segments []models.Segment) error {
	var content string

	switch {
	case strings.HasSuffix(outputPath, ".txt"):
		content = s.generateChaptersTXT(segments)
	case strings.HasSuffix(outputPath, ".xml"):
		content = s.generateChaptersXML(segments)
	case strings.HasSuffix(outputPath, ".json"):
		content = s.generateChaptersJSON(segments)
	default:
		return fmt.Errorf("unsupported chapters format")
	}

	return os.WriteFile(outputPath, []byte(content), 0644)
}

// generateChaptersTXT creates chapters in simple text format
func (s *OperationService) generateChaptersTXT(segments []models.Segment) string {
	var content strings.Builder
	for i, seg := range segments {
		if seg.End == nil {
			continue // Skip segments without end time
		}
		end := *seg.End

		name := seg.Name
		if name == "" {
			name = fmt.Sprintf("Chapter %d", i+1)
		}

		content.WriteString(fmt.Sprintf("%s\n", name))
		content.WriteString(fmt.Sprintf("00:%02d:%02d:%02d.%03d\n",
			int(seg.Start)/3600, (int(seg.Start)%3600)/60, int(seg.Start)%60, int((seg.Start-float64(int(seg.Start)))*1000)))
		content.WriteString(fmt.Sprintf("00:%02d:%02d:%02d.%03d\n\n",
			int(end)/3600, (int(end)%3600)/60, int(end)%60, int((end-float64(int(end)))*1000)))
	}
	return content.String()
}

// generateChaptersXML creates chapters in XML format (FFmpeg metadata)
func (s *OperationService) generateChaptersXML(segments []models.Segment) string {
	var content strings.Builder
	content.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<chapters>
`)

	for i, seg := range segments {
		if seg.End == nil {
			continue // Skip segments without end time
		}
		end := *seg.End

		name := seg.Name
		if name == "" {
			name = fmt.Sprintf("Chapter %d", i+1)
		}

		content.WriteString(fmt.Sprintf(`  <chapter>
    <start>%f</start>
    <end>%f</end>
    <title>%s</title>
  </chapter>
`, seg.Start, end, name))
	}

	content.WriteString(`</chapters>`)
	return content.String()
}

// generateChaptersJSON creates chapters in JSON format
func (s *OperationService) generateChaptersJSON(segments []models.Segment) string {
	type Chapter struct {
		Start float64 `json:"start"`
		End   float64 `json:"end"`
		Name  string  `json:"name"`
	}

	var chapters []Chapter
	for i, seg := range segments {
		if seg.End == nil {
			continue // Skip segments without end time
		}
		end := *seg.End

		name := seg.Name
		if name == "" {
			name = fmt.Sprintf("Chapter %d", i+1)
		}

		chapters = append(chapters, Chapter{
			Start: seg.Start,
			End:   end,
			Name:  name,
		})
	}

	data, _ := json.MarshalIndent(chapters, "", "  ")
	return string(data)
}

// mergeVideosWithIntroOutro merges videos with intro/outro using concat demuxer
func (s *OperationService) mergeVideosWithIntroOutro(ctx context.Context, inputPaths []string, outputPath string, onProgress ffmpeg.ProgressCallback) error {
	// Create concat file content
	concatContent := ""
	for _, path := range inputPaths {
		concatContent += fmt.Sprintf("file '%s'\n", path)
	}

	// Use FFmpeg concat demuxer for lossless merging
	args := []string{
		"-hide_banner",
		"-f", "concat",
		"-safe", "0",
		"-protocol_whitelist", "file,pipe,fd",
		"-i", "-",
		"-c", "copy",
		"-y",
		outputPath,
	}

	return s.ffmpeg.ExecuteWithStdin(ctx, ffmpeg.ExecuteOptions{
		Args: args,
		OnProgress: func(progress float64) {
			onProgress(0.2 + (progress * 0.8)) // 20-100% of total progress
		},
		StdinData: strings.NewReader(concatContent),
	})
}

func (s *OperationService) GetStatus(operationID string) (*models.Operation, error) {
	s.mu.RLock()
	operation, exists := s.operations[operationID]
	s.mu.RUnlock()
	if !exists {
		return nil, fmt.Errorf("operation not found: %s", operationID)
	}
	return operation, nil
}

// GeneratePreview creates a short preview video with effects applied
func (s *OperationService) GeneratePreview(request models.PreviewRequest) (*models.Operation, error) {
	operation := &models.Operation{
		ID:        uuid.New().String(),
		Type:      models.OperationTypePreview,
		ProjectID: request.VideoID,
		Status:    models.OperationStatusPending,
		Progress:  0,
		CreatedAt: time.Now(),
	}

	// Store operation
	s.mu.Lock()
	s.operations[operation.ID] = operation
	s.mu.Unlock()

	// Run preview generation in background
	go s.runPreviewGeneration(operation, request)

	return operation, nil
}

func (s *OperationService) runPreviewGeneration(operation *models.Operation, request models.PreviewRequest) {
	operation.Status = models.OperationStatusProcessing
	operation.Progress = 5
	ctx := context.Background()

	// Get video file path
	video, err := s.storage.GetVideo(request.VideoID)
	if err != nil {
		operation.Status = models.OperationStatusFailed
		operation.Error = fmt.Sprintf("video not found: %v", err)
		s.logger.Error("Failed to get video for preview",
			zap.String("videoId", request.VideoID),
			zap.Error(err),
		)
		return
	}

	inputPath := video.FilePath

	// Set default preview duration (5 seconds)
	previewDuration := request.Duration
	if previewDuration <= 0 || previewDuration > 15 {
		previewDuration = 5
	}

	// Ensure start time is valid
	startTime := request.StartTime
	if startTime < 0 {
		startTime = 0
	}

	// Calculate end time
	endTime := startTime + previewDuration
	if video.Duration > 0 && endTime > video.Duration {
		endTime = video.Duration
		startTime = endTime - previewDuration
		if startTime < 0 {
			startTime = 0
		}
	}

	s.logger.Info("Generating preview",
		zap.String("operationId", operation.ID),
		zap.String("inputPath", inputPath),
		zap.Float64("startTime", startTime),
		zap.Float64("endTime", endTime),
		zap.Float64("duration", previewDuration),
		zap.Bool("hasCrop", request.CropEnabled),
		zap.String("blurMode", request.BlurMode),
	)

	// Create output path for preview
	outputPath := s.storage.GetOutputPath(fmt.Sprintf("preview_%s.mp4", operation.ID))

	// Progress callback
	onProgress := func(progress float64) {
		scaledProgress := 10 + (progress * 85)
		if scaledProgress > operation.Progress {
			operation.Progress = scaledProgress
		}
	}

	// Build export request from preview request
	exportRequest := models.ExportRequest{
		CropEnabled:       request.CropEnabled,
		CropX:             request.CropX,
		CropY:             request.CropY,
		CropWidth:         request.CropWidth,
		CropHeight:        request.CropHeight,
		BlurMode:          request.BlurMode,
		BlurAutoIntensity: request.BlurIntensity,
		DetectionZones:    request.DetectionZones,
	}

	// Cut video with optional filters
	var exportErr error
	if s.hasFilters(exportRequest) || s.needsAutoBlur(exportRequest) {
		exportErr = s.cutVideoWithOptionalFilters(ctx, inputPath, outputPath, startTime, endTime, exportRequest, onProgress)
	} else {
		// Just cut without filters for plain preview
		exportErr = s.ffmpeg.CutVideo(ctx, inputPath, outputPath, startTime, endTime, onProgress)
	}

	if exportErr != nil {
		operation.Status = models.OperationStatusFailed
		operation.Error = exportErr.Error()
		s.logger.Error("Preview generation failed",
			zap.String("operationId", operation.ID),
			zap.Error(exportErr),
		)
		return
	}

	// Success
	now := time.Now()
	operation.Status = models.OperationStatusCompleted
	operation.Progress = 100
	operation.CompletedAt = &now
	operation.OutputFiles = []string{outputPath}

	s.logger.Info("Preview generated successfully",
		zap.String("operationId", operation.ID),
		zap.String("outputPath", outputPath),
	)
}

// buildFilterOptions creates FilterOptions from ExportRequest
// segmentStart is the start time of the segment being cut, used to adjust blur region times
func (s *OperationService) buildFilterOptions(request models.ExportRequest, segmentStart float64) ffmpeg.FilterOptions {
	opts := ffmpeg.FilterOptions{
		CropEnabled: request.CropEnabled,
		CropX:       request.CropX,
		CropY:       request.CropY,
		CropWidth:   request.CropWidth,
		CropHeight:  request.CropHeight,
	}

	// Add blur regions for manual mode
	// Adjust times relative to segment start (since -ss makes video start at 0)
	if request.BlurMode == "manual" && len(request.BlurRegions) > 0 {
		for _, region := range request.BlurRegions {
			// Adjust times relative to segment start
			adjustedStartTime := region.StartTime - segmentStart
			adjustedEndTime := region.EndTime - segmentStart

			// Skip regions that are entirely outside this segment
			if adjustedEndTime < 0 {
				continue // Region ends before segment starts
			}

			// Clamp start time to 0 if it's before segment start
			if adjustedStartTime < 0 {
				adjustedStartTime = 0
			}

			s.logger.Debug("Adding blur region",
				zap.Float64("originalStart", region.StartTime),
				zap.Float64("originalEnd", region.EndTime),
				zap.Float64("segmentStart", segmentStart),
				zap.Float64("adjustedStart", adjustedStartTime),
				zap.Float64("adjustedEnd", adjustedEndTime),
			)

			opts.BlurRegions = append(opts.BlurRegions, ffmpeg.BlurRegionFilter{
				X:             region.X,
				Y:             region.Y,
				Width:         region.Width,
				Height:        region.Height,
				StartTime:     adjustedStartTime,
				EndTime:       adjustedEndTime,
				BlurIntensity: region.BlurIntensity,
			})
		}
	}

	return opts
}

// hasFilters checks if any filters are enabled in the request
func (s *OperationService) hasFilters(request models.ExportRequest) bool {
	return request.CropEnabled || (request.BlurMode == "manual" && len(request.BlurRegions) > 0)
}

// needsAutoBlur checks if auto or guided face blur is requested
func (s *OperationService) needsAutoBlur(request models.ExportRequest) bool {
	return request.BlurMode == "auto" || request.BlurMode == "guided"
}

// needsGuidedBlur checks if guided face blur is requested
func (s *OperationService) needsGuidedBlur(request models.ExportRequest) bool {
	return request.BlurMode == "guided" && len(request.DetectionZones) > 0
}

// needsWatermark checks if watermark is enabled in the request
func (s *OperationService) needsWatermark(request models.ExportRequest) bool {
	return request.Watermark != nil && request.Watermark.Enabled && request.Watermark.Filename != ""
}

// ==================== Multi-Clip Timeline Export ====================

// ExportTimeline exports a timeline project with multiple clips
func (s *OperationService) ExportTimeline(project *models.TimelineProject, request *models.TimelineExportRequest) (string, error) {
	operation := &models.Operation{
		ID:        uuid.New().String(),
		Type:      models.OperationTypeExport,
		ProjectID: project.ID,
		Status:    models.OperationStatusPending,
		Progress:  0,
		CreatedAt: time.Now(),
	}

	// Store operation
	s.mu.Lock()
	s.operations[operation.ID] = operation
	s.mu.Unlock()

	// Run export in background
	go s.runTimelineExport(operation, project, request)

	return operation.ID, nil
}

func (s *OperationService) runTimelineExport(operation *models.Operation, project *models.TimelineProject, request *models.TimelineExportRequest) {
	operation.Status = models.OperationStatusProcessing
	operation.Progress = 5
	ctx := context.Background()

	s.logger.Info("Starting timeline export",
		zap.String("operationId", operation.ID),
		zap.String("projectId", project.ID),
		zap.Int("clipCount", len(project.TimelineClips)),
	)

	if len(project.TimelineClips) == 0 {
		operation.Status = models.OperationStatusFailed
		operation.Error = "no clips to export"
		return
	}

	// Ensure temp and output directories exist
	if err := os.MkdirAll(s.storage.TempDir(), 0755); err != nil {
		operation.Status = models.OperationStatusFailed
		operation.Error = fmt.Sprintf("failed to create temp directory: %v", err)
		return
	}
	if err := os.MkdirAll(s.storage.OutputsDir(), 0755); err != nil {
		operation.Status = models.OperationStatusFailed
		operation.Error = fmt.Sprintf("failed to create outputs directory: %v", err)
		return
	}

	// Check codec compatibility
	codecsCompatible, codecInfo, err := s.checkCodecCompatibility(project)
	if err != nil {
		operation.Status = models.OperationStatusFailed
		operation.Error = fmt.Sprintf("failed to check codec compatibility: %v", err)
		return
	}

	s.logger.Info("Codec compatibility check",
		zap.Bool("compatible", codecsCompatible),
		zap.Bool("forceReencode", request.ForceReencode),
		zap.String("codecInfo", codecInfo),
	)

	needsReencode := !codecsCompatible || request.ForceReencode || request.CropEnabled

	// Parallel clip cutting
	tempFiles := make([]string, len(project.TimelineClips))
	totalDuration := 0.0

	type cutResult struct {
		index    int
		tempFile string
		duration float64
		err      error
	}

	results := make(chan cutResult, len(project.TimelineClips))
	var wg sync.WaitGroup

	for i, clip := range project.TimelineClips {
		wg.Add(1)
		go func(idx int, c models.TimelineClip) {
			defer wg.Done()

			// Get source video
			video, err := s.storage.GetVideo(c.SourceVideoID)
			if err != nil {
				results <- cutResult{index: idx, err: fmt.Errorf("source video not found: %s", c.SourceVideoID)}
				return
			}

			tempFile := s.storage.GetTempPath(fmt.Sprintf("timeline_clip_%d_%s.mp4", idx, uuid.New().String()))

			clipDuration := c.SourceEnd - c.SourceStart

			s.logger.Info("Cutting timeline clip (parallel)",
				zap.Int("index", idx),
				zap.String("clipId", c.ID),
				zap.String("sourceVideo", c.SourceVideoID),
				zap.Float64("start", c.SourceStart),
				zap.Float64("end", c.SourceEnd),
				zap.Float64("duration", clipDuration),
			)

			// Progress callback for this clip
			clipProgress := func(progress float64) {
				// Scale progress: 5-80% for cutting clips
				baseProgress := 5.0
				cutRange := 70.0
				clipWeight := 1.0 / float64(len(project.TimelineClips))
				scaledProgress := baseProgress + (cutRange * (float64(idx) + progress) * clipWeight)
				if scaledProgress > operation.Progress {
					operation.Progress = scaledProgress
				}
			}

			// Cut the clip
			var cutErr error
			if needsReencode {
				filterOpts := ffmpeg.FilterOptions{
					CropEnabled: request.CropEnabled,
					CropX:       request.CropX,
					CropY:       request.CropY,
					CropWidth:   request.CropWidth,
					CropHeight:  request.CropHeight,
				}
				cutErr = s.ffmpeg.CutVideoWithFilters(ctx, video.FilePath, tempFile, c.SourceStart, c.SourceEnd, filterOpts, clipProgress)
			} else {
				// Use lossless cutting with stream copy (-c copy) - FAST!
				cutErr = s.ffmpeg.CutVideoLossless(ctx, video.FilePath, tempFile, c.SourceStart, c.SourceEnd, clipProgress)
			}

			if cutErr != nil {
				results <- cutResult{index: idx, err: cutErr}
				return
			}

			results <- cutResult{index: idx, tempFile: tempFile, duration: clipDuration}
		}(i, clip)
	}

	// Wait for all clips to finish cutting
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	for result := range results {
		if result.err != nil {
			operation.Status = models.OperationStatusFailed
			operation.Error = fmt.Sprintf("failed to cut clip %d: %v", result.index, result.err)
			s.cleanupTempFiles(tempFiles)
			return
		}
		tempFiles[result.index] = result.tempFile
		totalDuration += result.duration
	}

	// Build output filename
	outputName := request.OutputName
	if outputName == "" {
		outputName = fmt.Sprintf("%s_timeline_%d", project.Name, time.Now().Unix())
	}
	format := request.Format
	if format == "" {
		format = "mp4"
	}
	outputPath := s.storage.GetOutputPath(fmt.Sprintf("%s.%s", outputName, format))

	// Merge all clips
	s.logger.Info("Merging timeline clips",
		zap.Int("clipCount", len(tempFiles)),
		zap.Float64("totalDuration", totalDuration),
		zap.String("outputPath", outputPath),
		zap.Bool("needsReencode", needsReencode),
	)

	mergeProgress := func(progress float64) {
		// Scale progress: 80-95% for merging (leave room for watermark)
		scaledProgress := 80 + (progress * 15)
		if scaledProgress > operation.Progress {
			operation.Progress = scaledProgress
		}
	}

	// Check if watermark is enabled
	hasWatermark := request.Watermark != nil && request.Watermark.Enabled && request.Watermark.Filename != ""

	var mergeErr error
	var mergeOutput string

	if hasWatermark {
		// Merge to temp file first, then apply watermark
		mergeOutput = s.storage.GetTempPath(fmt.Sprintf("timeline_merged_%s.mp4", uuid.New().String()))
	} else {
		mergeOutput = outputPath
	}

	// Use concat demuxer for FASTEST merge when possible
	if !needsReencode && !hasWatermark {
		// Ultra-fast: Use concat demuxer with -c copy (no re-encoding at all)
		mergeErr = s.ffmpeg.MergeVideosConcatDemuxer(ctx, tempFiles, mergeOutput, mergeProgress)
	} else if !needsReencode && hasWatermark {
		// Fast: Use concat demuxer first, then apply watermark to final output
		concatOutput := s.storage.GetTempPath(fmt.Sprintf("timeline_concat_%s.mp4", uuid.New().String()))
		mergeErrConcat := s.ffmpeg.MergeVideosConcatDemuxer(ctx, tempFiles, concatOutput, mergeProgress)
		if mergeErrConcat == nil {
			// Now apply watermark with re-encoding
			wmProgress := func(progress float64) {
				scaledProgress := 95 + (progress * 5)
				if scaledProgress > operation.Progress {
					operation.Progress = scaledProgress
				}
			}
			watermarkPath := filepath.Join(s.storage.BasePath(), "watermarks", request.Watermark.Filename)
			watermarkOpts := ffmpeg.WatermarkOptions{
				ImagePath: watermarkPath,
				Position:  request.Watermark.Position,
				Opacity:   request.Watermark.Opacity,
				Scale:     request.Watermark.Scale,
				MarginX:   request.Watermark.MarginX,
				MarginY:   request.Watermark.MarginY,
			}
			mergeErr = s.ffmpeg.ApplyWatermark(ctx, concatOutput, mergeOutput, watermarkOpts, wmProgress)
			os.Remove(concatOutput)
		} else {
			mergeErr = mergeErrConcat
		}
	} else {
		// Slower: Re-encode all clips
		mergeErr = s.ffmpeg.MergeVideos(ctx, tempFiles, mergeOutput, totalDuration, mergeProgress)
	}

	// Cleanup temp files
	s.cleanupTempFiles(tempFiles)

	if mergeErr != nil {
		if hasWatermark {
			os.Remove(mergeOutput)
		}
		operation.Status = models.OperationStatusFailed
		operation.Error = fmt.Sprintf("failed to merge clips: %v", mergeErr)
		return
	}

	// Apply watermark if enabled
	if hasWatermark {
		s.logger.Info("Applying watermark",
			zap.String("filename", request.Watermark.Filename),
			zap.String("position", request.Watermark.Position),
			zap.Float64("opacity", request.Watermark.Opacity),
		)

		watermarkPath := filepath.Join(s.storage.BasePath(), "watermarks", request.Watermark.Filename)

		// Check watermark file exists
		if _, err := os.Stat(watermarkPath); os.IsNotExist(err) {
			os.Remove(mergeOutput)
			operation.Status = models.OperationStatusFailed
			operation.Error = "watermark file not found"
			return
		}

		watermarkOpts := ffmpeg.WatermarkOptions{
			ImagePath: watermarkPath,
			Position:  request.Watermark.Position,
			Opacity:   request.Watermark.Opacity,
			Scale:     request.Watermark.Scale,
			MarginX:   request.Watermark.MarginX,
			MarginY:   request.Watermark.MarginY,
		}

		wmProgress := func(progress float64) {
			// Scale progress: 95-100% for watermark
			scaledProgress := 95 + (progress * 5)
			if scaledProgress > operation.Progress {
				operation.Progress = scaledProgress
			}
		}

		// Apply watermark: re-encode merged video with watermark overlay
		wmErr := s.ffmpeg.CutVideoWithWatermark(ctx, mergeOutput, outputPath, 0, totalDuration, watermarkOpts, wmProgress)

		// Cleanup temp merged file
		os.Remove(mergeOutput)

		if wmErr != nil {
			operation.Status = models.OperationStatusFailed
			operation.Error = fmt.Sprintf("failed to apply watermark: %v", wmErr)
			return
		}
	}

	// Success
	now := time.Now()
	operation.Status = models.OperationStatusCompleted
	operation.Progress = 100
	operation.CompletedAt = &now
	operation.OutputFiles = []string{outputPath}

	s.logger.Info("Timeline export completed",
		zap.String("operationId", operation.ID),
		zap.String("outputPath", outputPath),
		zap.Float64("totalDuration", totalDuration),
	)
}

// checkCodecCompatibility checks if all videos in a timeline project have compatible codecs
func (s *OperationService) checkCodecCompatibility(project *models.TimelineProject) (bool, string, error) {
	if len(project.VideoIDs) <= 1 {
		return true, "single source", nil
	}

	var referenceCodec, referenceAudio string
	var referenceWidth, referenceHeight int

	for i, videoID := range project.VideoIDs {
		video, err := s.storage.GetVideo(videoID)
		if err != nil {
			return false, "", fmt.Errorf("video %s not found", videoID)
		}

		videoCodec := ""
		audioCodec := ""
		for _, stream := range video.Metadata.Streams {
			if stream.CodecType == "video" && videoCodec == "" {
				videoCodec = stream.CodecName
			} else if stream.CodecType == "audio" && audioCodec == "" {
				audioCodec = stream.CodecName
			}
		}

		if i == 0 {
			referenceCodec = videoCodec
			referenceAudio = audioCodec
			referenceWidth = video.Width
			referenceHeight = video.Height
			continue
		}

		// Check compatibility
		if videoCodec != referenceCodec {
			return false, fmt.Sprintf("video codec mismatch: %s vs %s", referenceCodec, videoCodec), nil
		}
		if audioCodec != referenceAudio {
			return false, fmt.Sprintf("audio codec mismatch: %s vs %s", referenceAudio, audioCodec), nil
		}
		if video.Width != referenceWidth || video.Height != referenceHeight {
			return false, fmt.Sprintf("resolution mismatch: %dx%d vs %dx%d", referenceWidth, referenceHeight, video.Width, video.Height), nil
		}
	}

	return true, "compatible", nil
}

// cleanupTempFiles removes temporary files
func (s *OperationService) cleanupTempFiles(files []string) {
	for _, f := range files {
		if f != "" {
			if err := os.Remove(f); err != nil {
				s.logger.Warn("Failed to cleanup temp file", zap.String("file", f), zap.Error(err))
			}
		}
	}
}

// cutVideoWithOptionalFilters cuts video with or without filters based on request
func (s *OperationService) cutVideoWithOptionalFilters(ctx context.Context, inputPath, outputPath string, start, end float64, request models.ExportRequest, onProgress ffmpeg.ProgressCallback) error {
	// First, cut the video (with crop/manual blur if needed)
	var tempOutput string
	var finalOutput string

	if s.needsAutoBlur(request) {
		// If auto-blur is needed, cut to temp file first
		tempOutput = outputPath + ".temp_cut.mp4"
		finalOutput = outputPath
	} else {
		tempOutput = outputPath
		finalOutput = outputPath
	}

	// Cut with optional crop/manual blur
	var err error
	if s.hasFilters(request) {
		// Pass segment start time to adjust blur region times
		filterOpts := s.buildFilterOptions(request, start)
		err = s.ffmpeg.CutVideoWithFilters(ctx, inputPath, tempOutput, start, end, filterOpts, func(p float64) {
			if onProgress != nil {
				if s.needsAutoBlur(request) {
					onProgress(p * 0.5) // First 50% for cutting
				} else {
					onProgress(p)
				}
			}
		})
	} else {
		err = s.ffmpeg.CutVideo(ctx, inputPath, tempOutput, start, end, func(p float64) {
			if onProgress != nil {
				if s.needsAutoBlur(request) {
					onProgress(p * 0.5) // First 50% for cutting
				} else {
					onProgress(p)
				}
			}
		})
	}

	if err != nil {
		return err
	}

	// Apply auto or guided face blur if needed
	if s.needsAutoBlur(request) {
		intensity := request.BlurAutoIntensity
		if intensity <= 0 {
			intensity = 25 // Default
		}

		if s.needsGuidedBlur(request) {
			// Guided mode - detect faces only in specified zones
			s.logger.Info("Applying guided face blur",
				zap.String("tempOutput", tempOutput),
				zap.String("finalOutput", finalOutput),
				zap.Int("intensity", intensity),
				zap.Int("zones", len(request.DetectionZones)),
			)

			// Convert models.DetectionZone to ffmpeg.DetectionZone
			zones := make([]ffmpeg.DetectionZone, len(request.DetectionZones))
			for i, z := range request.DetectionZones {
				zones[i] = ffmpeg.DetectionZone{
					ID:        z.ID,
					X:         z.X,
					Y:         z.Y,
					Radius:    z.Radius,
					StartTime: z.StartTime,
					EndTime:   z.EndTime,
				}
			}

			err = s.ffmpeg.BlurFacesGuided(ctx, tempOutput, finalOutput, intensity, zones, func(p float64) {
				if onProgress != nil {
					onProgress(0.5 + (p * 0.5)) // Last 50% for face blur
				}
			})
		} else {
			// Auto mode - full frame face detection
			s.logger.Info("Applying auto face blur",
				zap.String("tempOutput", tempOutput),
				zap.String("finalOutput", finalOutput),
				zap.Int("intensity", intensity),
				zap.Int("confirmedSignatures", len(request.BlurConfirmedSignatures)),
			)

			// Build blur style config
			var blurStyle *ffmpeg.BlurStyleConfig
			if request.BlurStyle != nil {
				blurStyle = &ffmpeg.BlurStyleConfig{
					Style:     request.BlurStyle.Style,
					Intensity: request.BlurStyle.Intensity,
					Color:     request.BlurStyle.Color,
					Emoji:     request.BlurStyle.Emoji,
					ImageData: request.BlurStyle.ImageData,
				}
			}

			err = s.ffmpeg.BlurFacesAuto(ctx, tempOutput, finalOutput, intensity, request.BlurConfirmedSignatures, blurStyle, func(p float64) {
				if onProgress != nil {
					onProgress(0.5 + (p * 0.5)) // Last 50% for face blur
				}
			})
		}

		// Clean up temp file
		s.storage.DeleteFile(tempOutput)

		if err != nil {
			return fmt.Errorf("face blur failed: %w", err)
		}
	}

	// Apply watermark if requested
	if s.needsWatermark(request) {
		watermarkPath := filepath.Join(s.storage.BasePath(), "watermarks", request.Watermark.Filename)

		// Check watermark file exists
		if _, err := os.Stat(watermarkPath); os.IsNotExist(err) {
			return fmt.Errorf("watermark file not found: %s", request.Watermark.Filename)
		}

		s.logger.Info("Applying watermark",
			zap.String("output", finalOutput),
			zap.String("watermarkPath", watermarkPath),
			zap.String("position", request.Watermark.Position),
			zap.Float64("opacity", request.Watermark.Opacity),
		)

		watermarkOpts := ffmpeg.WatermarkOptions{
			ImagePath: watermarkPath,
			Position:  request.Watermark.Position,
			Opacity:   request.Watermark.Opacity,
			Scale:     request.Watermark.Scale,
			MarginX:   request.Watermark.MarginX,
			MarginY:   request.Watermark.MarginY,
		}

		// Apply watermark (use temp file if needed)
		tempWatermarkOutput := finalOutput + ".watermark_temp.mp4"
		if err := s.ffmpeg.ApplyWatermark(ctx, finalOutput, tempWatermarkOutput, watermarkOpts, nil); err != nil {
			return fmt.Errorf("watermark failed: %w", err)
		}

		// Replace original with watermarked version
		if err := os.Remove(finalOutput); err != nil {
			s.logger.Warn("Failed to remove original before watermark", zap.Error(err))
		}
		if err := os.Rename(tempWatermarkOutput, finalOutput); err != nil {
			return fmt.Errorf("failed to rename watermarked output: %w", err)
		}
	}

	return nil
}

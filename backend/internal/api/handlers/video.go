package handlers

import (
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mifi/lossless-cut/backend/internal/config"
	"github.com/mifi/lossless-cut/backend/internal/ffmpeg"
	"github.com/mifi/lossless-cut/backend/internal/models"
	"github.com/mifi/lossless-cut/backend/internal/services"
	"go.uber.org/zap"
)

type VideoHandler struct {
	services *services.Services
	config   *config.Config
	logger   *zap.Logger
}

func NewVideoHandler(services *services.Services, cfg *config.Config, logger *zap.Logger) *VideoHandler {
	return &VideoHandler{
		services: services,
		config:   cfg,
		logger:   logger,
	}
}

func (h *VideoHandler) Upload(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
		return
	}

	// Get session ID from header
	sessionID := c.GetHeader("X-Session-ID")

	// Check file size
	if file.Size > h.config.Server.MaxUploadSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "file too large"})
		return
	}

	// Generate unique filename
	ext := filepath.Ext(file.Filename)
	filename := uuid.New().String() + ext
	destPath := h.services.Storage.GetVideoPath(filename)

	// Save file
	if err := c.SaveUploadedFile(file, destPath); err != nil {
		h.logger.Error("Failed to save uploaded file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	// Create video record with session ID
	video, err := h.services.Video.CreateFromUpload(file.Filename, destPath, sessionID)
	if err != nil {
		h.logger.Error("Failed to create video record", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create video"})
		return
	}

	h.logger.Info("Video uploaded successfully",
		zap.String("id", video.ID),
		zap.String("filename", file.Filename),
		zap.Int64("size", file.Size),
		zap.String("sessionID", sessionID),
	)

	c.JSON(http.StatusCreated, models.UploadResponse{
		VideoID: video.ID,
		Video:   video,
	})
}

func (h *VideoHandler) Download(c *gin.Context) {
	var req models.DownloadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Implement yt-dlp download
	c.JSON(http.StatusNotImplemented, gin.H{"error": "yt-dlp download not yet implemented"})
}

func (h *VideoHandler) Stream(c *gin.Context) {
	videoID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	// Get video metadata
	video, err := h.services.Video.GetVideo(videoID)
	if err != nil {
		h.logger.Error("Video not found", zap.String("id", videoID), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "video not found"})
		return
	}

	// Check session ownership (legacy videos with no session set remain accessible)
	if video.SessionID != "" && video.SessionID != sessionID {
		h.logger.Warn("Unauthorized stream attempt",
			zap.String("videoID", videoID),
			zap.String("videoSession", video.SessionID),
			zap.String("requestSession", sessionID),
		)
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to access this video"})
		return
	}

	videoPath := video.FilePath
	if !h.services.Storage.FileExists(videoPath) {
		h.logger.Error("Video file not found", zap.String("path", videoPath))
		c.JSON(http.StatusNotFound, gin.H{"error": "video file not found"})
		return
	}

	// Open file
	file, err := os.Open(videoPath)
	if err != nil {
		h.logger.Error("Failed to open video file", zap.String("path", videoPath), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open video"})
		return
	}
	defer file.Close()

	// Get file info
	fileInfo, err := file.Stat()
	if err != nil {
		h.logger.Error("Failed to stat video file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get file info"})
		return
	}

	fileSize := fileInfo.Size()

	// Detect content type from file extension
	contentType := getContentType(videoPath)

	// Handle HTTP Range requests for seeking support
	rangeHeader := c.GetHeader("Range")
	if rangeHeader != "" {
		h.handleRangeRequest(c, file, fileSize, contentType, rangeHeader)
		return
	}

	// No range request - serve entire file
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", strconv.FormatInt(fileSize, 10))
	c.Header("Accept-Ranges", "bytes")

	http.ServeContent(c.Writer, c.Request, fileInfo.Name(), fileInfo.ModTime(), file)
}

// handleRangeRequest handles HTTP Range requests for video seeking
func (h *VideoHandler) handleRangeRequest(c *gin.Context, file *os.File, fileSize int64, contentType, rangeHeader string) {
	// Parse range header: "bytes=start-end"
	if !strings.HasPrefix(rangeHeader, "bytes=") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid range header"})
		return
	}

	rangeSpec := strings.TrimPrefix(rangeHeader, "bytes=")
	parts := strings.Split(rangeSpec, "-")
	if len(parts) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid range format"})
		return
	}

	var start, end int64
	var err error

	if parts[0] != "" {
		start, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid range start"})
			return
		}
	}

	if parts[1] != "" {
		end, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid range end"})
			return
		}
	} else {
		// No end specified - serve from start to end of file
		// Limit chunk size to 10MB for better streaming performance
		maxChunkSize := int64(10 * 1024 * 1024)
		end = start + maxChunkSize - 1
		if end >= fileSize {
			end = fileSize - 1
		}
	}

	// Validate range
	if start < 0 || start >= fileSize || end < start || end >= fileSize {
		c.Header("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
		c.JSON(http.StatusRequestedRangeNotSatisfiable, gin.H{"error": "range not satisfiable"})
		return
	}

	contentLength := end - start + 1

	// Seek to start position
	if _, err := file.Seek(start, 0); err != nil {
		h.logger.Error("Failed to seek file", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "seek failed"})
		return
	}

	// Set response headers
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", strconv.FormatInt(contentLength, 10))
	c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
	c.Header("Accept-Ranges", "bytes")
	c.Status(http.StatusPartialContent)

	// Stream the requested range
	written, err := copyN(c.Writer, file, contentLength)
	if err != nil {
		h.logger.Debug("Range streaming interrupted",
			zap.Int64("written", written),
			zap.Int64("expected", contentLength),
			zap.Error(err),
		)
	}
}

// copyN copies exactly n bytes from src to dst
func copyN(dst http.ResponseWriter, src *os.File, n int64) (int64, error) {
	buf := make([]byte, 32*1024) // 32KB buffer
	var written int64

	for written < n {
		toRead := n - written
		if toRead > int64(len(buf)) {
			toRead = int64(len(buf))
		}

		nr, err := src.Read(buf[:toRead])
		if nr > 0 {
			nw, werr := dst.Write(buf[:nr])
			written += int64(nw)
			if werr != nil {
				return written, werr
			}
		}
		if err != nil {
			return written, err
		}
	}

	return written, nil
}

// getContentType returns the MIME type based on file extension
func getContentType(filePath string) string {
	ext := strings.ToLower(filepath.Ext(filePath))

	// Common video/audio MIME types
	mimeTypes := map[string]string{
		".mp4":  "video/mp4",
		".mov":  "video/quicktime",
		".m4v":  "video/x-m4v",
		".mkv":  "video/x-matroska",
		".webm": "video/webm",
		".avi":  "video/x-msvideo",
		".wmv":  "video/x-ms-wmv",
		".flv":  "video/x-flv",
		".3gp":  "video/3gpp",
		".ogv":  "video/ogg",
		".ts":   "video/mp2t",
		".mts":  "video/mp2t",
		".m2ts": "video/mp2t",
		// Audio
		".mp3":  "audio/mpeg",
		".aac":  "audio/aac",
		".m4a":  "audio/mp4",
		".wav":  "audio/wav",
		".flac": "audio/flac",
		".ogg":  "audio/ogg",
		".wma":  "audio/x-ms-wma",
	}

	if mimeType, ok := mimeTypes[ext]; ok {
		return mimeType
	}

	// Fallback to mime package
	if mimeType := mime.TypeByExtension(ext); mimeType != "" {
		return mimeType
	}

	return "application/octet-stream"
}

func (h *VideoHandler) Waveform(c *gin.Context) {
	videoID := c.Param("id")

	// Generate waveform
	waveformPath, err := h.services.Video.GenerateWaveform(videoID)
	if err != nil {
		h.logger.Error("Failed to generate waveform", zap.String("videoId", videoID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate waveform"})
		return
	}

	// Serve the waveform image
	c.Header("Content-Type", "image/png")
	c.Header("Cache-Control", "public, max-age=86400") // Cache for 1 day
	c.File(waveformPath)
}

func (h *VideoHandler) Delete(c *gin.Context) {
	videoID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	// Verify ownership before deletion
	video, err := h.services.Video.GetVideo(videoID)
	if err != nil {
		h.logger.Error("Video not found", zap.String("id", videoID), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "video not found"})
		return
	}

	// Check if video belongs to this session (if session is set)
	if video.SessionID != "" && video.SessionID != sessionID {
		h.logger.Warn("Unauthorized delete attempt",
			zap.String("videoID", videoID),
			zap.String("videoSession", video.SessionID),
			zap.String("requestSession", sessionID),
		)
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to delete this video"})
		return
	}

	if err := h.services.Video.DeleteVideo(videoID); err != nil {
		h.logger.Error("Failed to delete video", zap.String("id", videoID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete video"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "video deleted"})
}

type RenameRequest struct {
	FileName string `json:"file_name" binding:"required"`
}

func (h *VideoHandler) Rename(c *gin.Context) {
	videoID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	video, err := h.services.Video.GetVideo(videoID)
	if err != nil {
		h.logger.Error("Video not found", zap.String("id", videoID), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "video not found"})
		return
	}

	if video.SessionID != "" && video.SessionID != sessionID {
		h.logger.Warn("Unauthorized rename attempt", zap.String("videoID", videoID))
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	var req RenameRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if req.FileName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file_name is required"})
		return
	}

	updated, err := h.services.Video.RenameVideo(videoID, req.FileName)
	if err != nil {
		h.logger.Error("Failed to rename video", zap.String("id", videoID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to rename video"})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// ScreenshotRequest represents the request body for screenshot capture
type ScreenshotRequest struct {
	Timestamp float64 `json:"timestamp" binding:"required"`
	Quality   int     `json:"quality"` // 1-31, lower is better quality
}

func (h *VideoHandler) Screenshot(c *gin.Context) {
	videoID := c.Param("id")

	var req ScreenshotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Capture screenshot
	filename, err := h.services.Video.CaptureScreenshot(videoID, req.Timestamp)
	if err != nil {
		h.logger.Error("Failed to capture screenshot",
			zap.String("videoId", videoID),
			zap.Float64("timestamp", req.Timestamp),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to capture screenshot"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"filename": filename,
		"url":      "/api/screenshots/" + filename,
	})
}

func (h *VideoHandler) ServeScreenshot(c *gin.Context) {
	filename := c.Param("filename")
	filepath := h.services.Storage.GetScreenshotPath(filename)

	if !h.services.Storage.FileExists(filepath) {
		h.logger.Warn("Screenshot not found", zap.String("filename", filename))
		c.JSON(http.StatusNotFound, gin.H{"error": "screenshot not found"})
		return
	}

	c.Header("Content-Type", "image/jpeg")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	c.File(filepath)
}

func (h *VideoHandler) List(c *gin.Context) {
	sessionID := c.GetHeader("X-Session-ID")

	videos, err := h.services.Video.ListVideos()
	if err != nil {
		h.logger.Error("Failed to list videos", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list videos"})
		return
	}

	// Filter by session ID (keep legacy videos with no session set)
	filtered := make([]*models.Video, 0, len(videos))
	for _, v := range videos {
		if v.SessionID == "" || v.SessionID == sessionID {
			filtered = append(filtered, v)
		}
	}

	c.JSON(http.StatusOK, filtered)
}

// DetectFacesRequest represents the request for face detection
type DetectFacesRequest struct {
	Interval     float64            `json:"interval"`      // Sample interval in seconds
	MaxFaces     int                `json:"max_faces"`     // Maximum faces to detect
	GroupSimilar *bool              `json:"group_similar"` // Group similar faces (default: true)
	Segments     []ffmpeg.TimeRange `json:"segments"`      // Time ranges to scan (empty = entire video)
}

// DetectFaces scans a video and returns detected face thumbnails for confirmation
func (h *VideoHandler) DetectFaces(c *gin.Context) {
	videoID := c.Param("id")

	// Get video metadata
	video, err := h.services.Video.GetVideo(videoID)
	if err != nil {
		h.logger.Error("Video not found", zap.String("id", videoID), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "video not found"})
		return
	}

	var req DetectFacesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Use defaults
		req.Interval = 0.5
		req.MaxFaces = 20
	}

	if req.Interval <= 0 {
		req.Interval = 0.5
	}
	if req.MaxFaces <= 0 {
		req.MaxFaces = 20
	}

	// Default to grouping similar faces
	groupSimilar := true
	if req.GroupSimilar != nil {
		groupSimilar = *req.GroupSimilar
	}

	h.logger.Info("Starting face detection",
		zap.String("videoId", videoID),
		zap.Bool("groupSimilar", groupSimilar),
		zap.Int("segments", len(req.Segments)),
	)

	// Run face detection script
	result, err := h.services.Video.DetectFaces(video.FilePath, req.Interval, req.MaxFaces, groupSimilar, req.Segments)
	if err != nil {
		h.logger.Error("Face detection failed", zap.String("videoId", videoID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "face detection failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ==================== Multi-Clip Timeline Endpoints ====================

// BatchUpload handles uploading multiple video files at once
func (h *VideoHandler) BatchUpload(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to parse multipart form"})
		return
	}

	files := form.File["files"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no files provided"})
		return
	}

	sessionID := c.GetHeader("X-Session-ID")
	response := models.BatchUploadResponse{
		Videos: make([]*models.Video, 0, len(files)),
		Errors: make([]string, 0),
	}

	for _, file := range files {
		// Check file size
		if file.Size > h.config.Server.MaxUploadSize {
			response.Errors = append(response.Errors, fmt.Sprintf("%s: file too large", file.Filename))
			response.Failed++
			continue
		}

		// Generate unique filename
		ext := filepath.Ext(file.Filename)
		filename := uuid.New().String() + ext
		destPath := h.services.Storage.GetVideoPath(filename)

		// Save file
		if err := c.SaveUploadedFile(file, destPath); err != nil {
			h.logger.Error("Failed to save uploaded file", zap.String("filename", file.Filename), zap.Error(err))
			response.Errors = append(response.Errors, fmt.Sprintf("%s: failed to save", file.Filename))
			response.Failed++
			continue
		}

		// Create video record
		video, err := h.services.Video.CreateFromUpload(file.Filename, destPath, sessionID)
		if err != nil {
			h.logger.Error("Failed to create video record", zap.String("filename", file.Filename), zap.Error(err))
			response.Errors = append(response.Errors, fmt.Sprintf("%s: failed to process", file.Filename))
			response.Failed++
			// Clean up saved file
			os.Remove(destPath)
			continue
		}

		response.Videos = append(response.Videos, video)
		response.Success++

		h.logger.Info("Video uploaded in batch",
			zap.String("id", video.ID),
			zap.String("filename", file.Filename),
			zap.String("sessionID", sessionID),
		)
	}

	c.JSON(http.StatusCreated, response)
}

// CheckCodecCompatibility checks if multiple videos can be merged losslessly
func (h *VideoHandler) CheckCodecCompatibility(c *gin.Context) {
	var req struct {
		VideoIDs []string `json:"video_ids" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(req.VideoIDs) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least 2 videos required"})
		return
	}

	codecs := make([]models.CodecInfo, 0, len(req.VideoIDs))
	var referenceCodec *models.CodecInfo

	for i, videoID := range req.VideoIDs {
		video, err := h.services.Video.GetVideo(videoID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("video %s not found", videoID)})
			return
		}

		// Extract codec info from metadata
		codecInfo := models.CodecInfo{
			Width:  video.Width,
			Height: video.Height,
		}

		for _, stream := range video.Metadata.Streams {
			if stream.CodecType == "video" && codecInfo.VideoCodec == "" {
				codecInfo.VideoCodec = stream.CodecName
				if stream.SampleRate > 0 {
					codecInfo.FrameRate = fmt.Sprintf("%d", stream.SampleRate)
				}
			} else if stream.CodecType == "audio" && codecInfo.AudioCodec == "" {
				codecInfo.AudioCodec = stream.CodecName
				codecInfo.SampleRate = stream.SampleRate
			}
		}

		codecs = append(codecs, codecInfo)

		if i == 0 {
			referenceCodec = &codecs[0]
		}
	}

	// Check compatibility
	result := models.CodecCompatibility{
		Compatible:     true,
		RequiresEncode: false,
		Codecs:         codecs,
	}

	for i, codec := range codecs {
		if i == 0 {
			continue
		}

		if codec.VideoCodec != referenceCodec.VideoCodec {
			result.Compatible = false
			result.RequiresEncode = true
			result.Reason = fmt.Sprintf("different video codecs: %s vs %s", referenceCodec.VideoCodec, codec.VideoCodec)
			break
		}

		if codec.AudioCodec != referenceCodec.AudioCodec {
			result.Compatible = false
			result.RequiresEncode = true
			result.Reason = fmt.Sprintf("different audio codecs: %s vs %s", referenceCodec.AudioCodec, codec.AudioCodec)
			break
		}

		if codec.Width != referenceCodec.Width || codec.Height != referenceCodec.Height {
			result.Compatible = false
			result.RequiresEncode = true
			result.Reason = fmt.Sprintf("different resolutions: %dx%d vs %dx%d",
				referenceCodec.Width, referenceCodec.Height, codec.Width, codec.Height)
			break
		}
	}

	c.JSON(http.StatusOK, result)
}

// Thumbnail generates and serves a thumbnail for a video
func (h *VideoHandler) Thumbnail(c *gin.Context) {
	videoID := c.Param("id")

	// Get optional timestamp parameter (default: 0)
	timestampStr := c.Query("t")
	timestamp := 0.0
	if timestampStr != "" {
		if t, err := strconv.ParseFloat(timestampStr, 64); err == nil {
			timestamp = t
		}
	}

	// Generate thumbnail using screenshot functionality
	filename, err := h.services.Video.CaptureScreenshot(videoID, timestamp)
	if err != nil {
		h.logger.Error("Failed to generate thumbnail",
			zap.String("videoId", videoID),
			zap.Float64("timestamp", timestamp),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate thumbnail"})
		return
	}

	// Serve the thumbnail
	filepath := h.services.Storage.GetScreenshotPath(filename)
	c.Header("Content-Type", "image/jpeg")
	c.Header("Cache-Control", "public, max-age=86400")
	c.File(filepath)
}

// WatermarkUpload handles watermark image upload
func (h *VideoHandler) WatermarkUpload(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
		return
	}

	// Validate file type (PNG only for transparency support)
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".png" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only PNG files are supported for watermarks"})
		return
	}

	// Check file size (max 5MB for watermarks)
	if file.Size > 5*1024*1024 {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "watermark file too large (max 5MB)"})
		return
	}

	// Generate unique filename
	watermarkID := uuid.New().String()
	filename := watermarkID + ext

	// Save to watermarks directory
	watermarkDir := filepath.Join(h.config.Storage.BasePath, "watermarks")
	if err := os.MkdirAll(watermarkDir, 0755); err != nil {
		h.logger.Error("Failed to create watermarks directory", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save watermark"})
		return
	}

	watermarkPath := filepath.Join(watermarkDir, filename)
	if err := c.SaveUploadedFile(file, watermarkPath); err != nil {
		h.logger.Error("Failed to save watermark", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save watermark"})
		return
	}

	h.logger.Info("Watermark uploaded", zap.String("id", watermarkID), zap.String("filename", filename))

	c.JSON(http.StatusOK, gin.H{
		"id":       watermarkID,
		"filename": filename,
		"url":      "/api/watermarks/" + filename,
	})
}

// WatermarkServe serves a watermark image
func (h *VideoHandler) WatermarkServe(c *gin.Context) {
	filename := c.Param("filename")

	// Sanitize filename
	filename = filepath.Base(filename)
	if !strings.HasSuffix(strings.ToLower(filename), ".png") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid watermark filename"})
		return
	}

	watermarkPath := filepath.Join(h.config.Storage.BasePath, "watermarks", filename)

	if _, err := os.Stat(watermarkPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "watermark not found"})
		return
	}

	c.Header("Content-Type", "image/png")
	c.Header("Cache-Control", "public, max-age=86400")
	c.File(watermarkPath)
}

// WatermarkDelete deletes a watermark
func (h *VideoHandler) WatermarkDelete(c *gin.Context) {
	filename := c.Param("filename")

	// Sanitize filename
	filename = filepath.Base(filename)
	if !strings.HasSuffix(strings.ToLower(filename), ".png") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid watermark filename"})
		return
	}

	watermarkPath := filepath.Join(h.config.Storage.BasePath, "watermarks", filename)

	if err := os.Remove(watermarkPath); err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "watermark not found"})
			return
		}
		h.logger.Error("Failed to delete watermark", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete watermark"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "watermark deleted"})
}

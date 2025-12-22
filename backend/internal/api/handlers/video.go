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

	// Create video record
	video, err := h.services.Video.CreateFromUpload(file.Filename, destPath)
	if err != nil {
		h.logger.Error("Failed to create video record", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create video"})
		return
	}

	h.logger.Info("Video uploaded successfully",
		zap.String("id", video.ID),
		zap.String("filename", file.Filename),
		zap.Int64("size", file.Size),
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

	// Get video metadata
	video, err := h.services.Video.GetVideo(videoID)
	if err != nil {
		h.logger.Error("Video not found", zap.String("id", videoID), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "video not found"})
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

	if err := h.services.Video.DeleteVideo(videoID); err != nil {
		h.logger.Error("Failed to delete video", zap.String("id", videoID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete video"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "video deleted"})
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
	videos, err := h.services.Video.ListVideos()
	if err != nil {
		h.logger.Error("Failed to list videos", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list videos"})
		return
	}

	c.JSON(http.StatusOK, videos)
}

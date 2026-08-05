package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mifi/lossless-cut/backend/internal/services"
	"go.uber.org/zap"
)

type DownloadHandler struct {
	services *services.Services
	logger   *zap.Logger
}

func NewDownloadHandler(services *services.Services, logger *zap.Logger) *DownloadHandler {
	return &DownloadHandler{
		services: services,
		logger:   logger,
	}
}

// Start initiates a video download from URL
func (h *DownloadHandler) Start(c *gin.Context) {
	var req services.DownloadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get session ID from header
	sessionID := c.GetHeader("X-Session-ID")
	req.SessionID = sessionID

	download, err := h.services.Download.StartDownload(c.Request.Context(), req)
	if err != nil {
		h.logger.Error("Failed to start download", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, download)
}

// Get retrieves download status
func (h *DownloadHandler) Get(c *gin.Context) {
	id := c.Param("id")

	download, err := h.services.Download.GetDownload(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, download)
}

// File serves the downloaded file (for playback/download).
func (h *DownloadHandler) File(c *gin.Context) {
	id := c.Param("id")
	download, err := h.services.Download.GetDownload(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if download.FilePath == "" || !h.services.Storage.FileExists(download.FilePath) {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	c.Header("Content-Disposition", "attachment")
	c.File(download.FilePath)
}

// List returns all downloads
func (h *DownloadHandler) List(c *gin.Context) {
	downloads, err := h.services.Download.ListDownloads()
	if err != nil {
		h.logger.Error("Failed to list downloads", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"downloads": downloads})
}

// Cancel cancels a download
func (h *DownloadHandler) Cancel(c *gin.Context) {
	id := c.Param("id")

	if err := h.services.Download.CancelDownload(id); err != nil {
		h.logger.Error("Failed to cancel download", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "download cancelled"})
}

// ClearAll deletes all download history
func (h *DownloadHandler) ClearAll(c *gin.Context) {
	if err := h.services.Storage.ClearAllDownloads(); err != nil {
		h.logger.Error("Failed to clear downloads", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.logger.Info("Cleared all download history")
	c.JSON(http.StatusOK, gin.H{"message": "all downloads cleared"})
}

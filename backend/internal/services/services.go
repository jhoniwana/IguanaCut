package services

import (
	"time"

	"github.com/mifi/lossless-cut/backend/internal/config"
	"github.com/mifi/lossless-cut/backend/internal/storage"
	"go.uber.org/zap"
)

// Services holds all application services
type Services struct {
	Project   *ProjectService
	Video     *VideoService
	Operation *OperationService
	Download  *DownloadService
	Cleanup   *CleanupService
	Storage   *storage.Manager
	Logger    *zap.Logger
}

// NewServices creates a new services instance
func NewServices(storageManager *storage.Manager, cfg *config.Config, logger *zap.Logger) *Services {
	videoService := NewVideoService(storageManager, cfg, logger)

	// Cleanup service: check every hour, delete files older than 24 hours
	cleanupInterval := 1 * time.Hour
	maxFileAge := 24 * time.Hour
	cleanupService := NewCleanupService(storageManager, logger, cleanupInterval, maxFileAge)

	return &Services{
		Project:   NewProjectService(storageManager, logger),
		Video:     videoService,
		Operation: NewOperationService(storageManager, cfg, logger),
		Download:  NewDownloadService(storageManager, videoService, cfg, logger),
		Cleanup:   cleanupService,
		Storage:   storageManager,
		Logger:    logger,
	}
}

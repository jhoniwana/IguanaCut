package services

import (
	"context"
	"time"

	"github.com/mifi/lossless-cut/backend/internal/storage"
	"go.uber.org/zap"
)

// CleanupService handles automatic cleanup of old files
type CleanupService struct {
	storage  *storage.Manager
	logger   *zap.Logger
	interval time.Duration
	maxAge   time.Duration
	stopCh   chan struct{}
}

// NewCleanupService creates a new cleanup service
func NewCleanupService(storage *storage.Manager, logger *zap.Logger, interval, maxAge time.Duration) *CleanupService {
	return &CleanupService{
		storage:  storage,
		logger:   logger,
		interval: interval,
		maxAge:   maxAge,
		stopCh:   make(chan struct{}),
	}
}

// Start begins the cleanup service in a background goroutine
func (s *CleanupService) Start(ctx context.Context) {
	s.logger.Info("Starting cleanup service",
		zap.Duration("interval", s.interval),
		zap.Duration("maxAge", s.maxAge),
	)

	// Run initial cleanup
	go s.runCleanup()

	// Start periodic cleanup
	go func() {
		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				s.runCleanup()
			case <-s.stopCh:
				s.logger.Info("Cleanup service stopped")
				return
			case <-ctx.Done():
				s.logger.Info("Cleanup service context cancelled")
				return
			}
		}
	}()
}

// Stop halts the cleanup service
func (s *CleanupService) Stop() {
	close(s.stopCh)
}

// runCleanup performs the actual cleanup
func (s *CleanupService) runCleanup() {
	s.logger.Info("Running scheduled cleanup")
	deleted, err := s.storage.CleanupOldFiles(s.maxAge)
	if err != nil {
		s.logger.Error("Cleanup failed", zap.Error(err))
	} else {
		s.logger.Info("Scheduled cleanup completed", zap.Int("filesDeleted", deleted))
	}
}

// RunNow triggers an immediate cleanup
func (s *CleanupService) RunNow() (int, error) {
	s.logger.Info("Running manual cleanup")
	return s.storage.CleanupOldFiles(s.maxAge)
}

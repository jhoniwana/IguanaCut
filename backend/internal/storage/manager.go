package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mifi/lossless-cut/backend/internal/models"
	"go.uber.org/zap"
)

// Manager handles file storage operations
type Manager struct {
	basePath string
	logger   *zap.Logger
}

// NewManager creates a new storage manager
func NewManager(basePath string, logger *zap.Logger) *Manager {
	return &Manager{
		basePath: basePath,
		logger:   logger,
	}
}

// Initialize creates the storage directory structure
func (m *Manager) Initialize() error {
	dirs := []string{
		m.UploadsDir(),
		m.ProjectsDir(),
		m.OutputsDir(),
		m.TempDir(),
		m.DownloadsDir(),
		m.VideosDir(),
		m.WaveformsDir(),
		m.ScreenshotsDir(),
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
		m.logger.Info("Created storage directory", zap.String("path", dir))
	}

	return nil
}

// BasePath returns the storage base path
func (m *Manager) BasePath() string {
	return m.basePath
}

// UploadsDir returns the uploads directory path
func (m *Manager) UploadsDir() string {
	return filepath.Join(m.basePath, "uploads")
}

// ProjectsDir returns the projects directory path
func (m *Manager) ProjectsDir() string {
	return filepath.Join(m.basePath, "projects")
}

// OutputsDir returns the outputs directory path
func (m *Manager) OutputsDir() string {
	return filepath.Join(m.basePath, "outputs")
}

// TempDir returns the temp directory path
func (m *Manager) TempDir() string {
	return filepath.Join(m.basePath, "temp")
}

// DownloadsDir returns the downloads directory path
func (m *Manager) DownloadsDir() string {
	return filepath.Join(m.basePath, "downloads")
}

// VideosDir returns the videos metadata directory path
func (m *Manager) VideosDir() string {
	return filepath.Join(m.basePath, "videos")
}

// WaveformsDir returns the waveforms cache directory path
func (m *Manager) WaveformsDir() string {
	return filepath.Join(m.basePath, "waveforms")
}

// ScreenshotsDir returns the screenshots directory path
func (m *Manager) ScreenshotsDir() string {
	return filepath.Join(m.basePath, "screenshots")
}

// GetScreenshotPath returns the full path for a screenshot file
func (m *Manager) GetScreenshotPath(filename string) string {
	return filepath.Join(m.ScreenshotsDir(), filename)
}

// GetWaveformPath returns the full path for a waveform file
func (m *Manager) GetWaveformPath(filename string) string {
	return filepath.Join(m.WaveformsDir(), filename)
}

// GetVideoPath returns the full path for a video file
func (m *Manager) GetVideoPath(filename string) string {
	return filepath.Join(m.UploadsDir(), filename)
}

// GetNextVideoNumber returns the next sequential video number and increments the counter
func (m *Manager) GetNextVideoNumber() int {
	counterFile := filepath.Join(m.basePath, "video_counter.txt")

	// Read current counter
	data, err := os.ReadFile(counterFile)
	currentNum := 1
	if err == nil {
		if num, parseErr := strconv.Atoi(strings.TrimSpace(string(data))); parseErr == nil {
			currentNum = num
		}
	}

	// Increment and save new counter
	nextNum := currentNum + 1
	if err := os.WriteFile(counterFile, []byte(strconv.Itoa(nextNum)), 0644); err != nil {
		m.logger.Error("Failed to write video counter", zap.String("path", counterFile), zap.Error(err))
	}

	m.logger.Info("Generated video number", zap.Int("number", currentNum))
	return currentNum
}

// ResetVideoCounter resets the video counter back to 1
func (m *Manager) ResetVideoCounter() error {
	counterFile := filepath.Join(m.basePath, "video_counter.txt")
	if err := os.WriteFile(counterFile, []byte("1"), 0644); err != nil {
		return fmt.Errorf("failed to reset counter: %w", err)
	}
	m.logger.Info("Reset video counter to 1")
	return nil
}

// GetProjectPath returns the full path for a project file
func (m *Manager) GetProjectPath(projectID string) string {
	return filepath.Join(m.ProjectsDir(), projectID+".llc")
}

// GetProject loads a project from disk
func (m *Manager) GetProject(projectID string) (*models.Project, error) {
	path := m.GetProjectPath(projectID)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("project not found: %s", projectID)
		}
		return nil, fmt.Errorf("failed to read project: %w", err)
	}

	var project models.Project
	if err := json.Unmarshal(data, &project); err != nil {
		return nil, fmt.Errorf("failed to parse project: %w", err)
	}

	return &project, nil
}

// outputsIndexFile is the persisted mapping output file -> source video.
type outputsIndexFile struct {
	Outputs []models.OutputFile `json:"outputs"`
}

// OutputsIndexPath returns the path of the outputs index file.
func (m *Manager) OutputsIndexPath() string {
	return filepath.Join(m.OutputsDir(), ".outputs_index.json")
}

// RegisterOutput records an exported file linked to its source video.
func (m *Manager) RegisterOutput(fileName, videoID string) error {
	idx, err := m.loadOutputsIndex()
	if err != nil {
		return err
	}
	idx.Outputs = append(idx.Outputs, models.OutputFile{
		FileName:  fileName,
		CreatedAt: time.Now(),
		VideoID:   videoID,
	})
	return m.saveOutputsIndex(idx)
}

// ListOutputs merges the files on disk with the persisted index.
func (m *Manager) ListOutputs() ([]models.OutputFile, error) {
	idx, err := m.loadOutputsIndex()
	if err != nil {
		return nil, err
	}
	byName := map[string]models.OutputFile{}
	for _, o := range idx.Outputs {
		byName[o.FileName] = o
	}
	entries, err := os.ReadDir(m.OutputsDir())
	if err != nil {
		return nil, err
	}
	out := []models.OutputFile{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		meta, _ := byName[e.Name()]
		out = append(out, models.OutputFile{
			FileName:  e.Name(),
			Size:      info.Size(),
			CreatedAt: meta.CreatedAt,
			VideoID:   meta.VideoID,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

// RemoveOutput deletes the file and its index entry.
func (m *Manager) RemoveOutput(fileName string) error {
	if err := os.Remove(m.GetOutputPath(fileName)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete output %s: %w", fileName, err)
	}
	idx, err := m.loadOutputsIndex()
	if err != nil {
		return err
	}
	filtered := idx.Outputs[:0]
	for _, o := range idx.Outputs {
		if o.FileName != fileName {
			filtered = append(filtered, o)
		}
	}
	idx.Outputs = filtered
	return m.saveOutputsIndex(idx)
}

func (m *Manager) loadOutputsIndex() (outputsIndexFile, error) {
	var idx outputsIndexFile
	data, err := os.ReadFile(m.OutputsIndexPath())
	if err != nil {
		if os.IsNotExist(err) {
			return idx, nil
		}
		return idx, err
	}
	if err := json.Unmarshal(data, &idx); err != nil {
		return idx, err
	}
	if idx.Outputs == nil {
		idx.Outputs = []models.OutputFile{}
	}
	return idx, nil
}

func (m *Manager) saveOutputsIndex(idx outputsIndexFile) error {
	data, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.OutputsIndexPath(), data, 0644)
}

// GetOutputPath returns the full path for an output file
func (m *Manager) GetOutputPath(filename string) string {
	return filepath.Join(m.OutputsDir(), filename)
}

// GetTempPath returns a temp file path
func (m *Manager) GetTempPath(filename string) string {
	return filepath.Join(m.TempDir(), filename)
}

// DeleteFile removes a file
func (m *Manager) DeleteFile(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete file %s: %w", path, err)
	}
	return nil
}

// FileExists checks if a file exists
func (m *Manager) FileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// GetFileSize returns the size of a file
func (m *Manager) GetFileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// GetDownloadPath returns the downloads directory for video files
func (m *Manager) GetDownloadPath() string {
	return m.DownloadsDir()
}

// GetDownloadMetadataPath returns the path for download metadata JSON
func (m *Manager) GetDownloadMetadataPath(downloadID string) string {
	return filepath.Join(m.DownloadsDir(), downloadID+".json")
}

// CreateDownload creates a new download record
func (m *Manager) CreateDownload(download *models.Download) error {
	if download.ID == "" {
		download.ID = uuid.New().String()
	}
	download.CreatedAt = time.Now()
	download.UpdatedAt = time.Now()

	return m.UpdateDownload(download)
}

// GetDownload retrieves a download by ID
func (m *Manager) GetDownload(id string) (*models.Download, error) {
	path := m.GetDownloadMetadataPath(id)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("download not found: %s", id)
		}
		return nil, fmt.Errorf("failed to read download: %w", err)
	}

	var download models.Download
	if err := json.Unmarshal(data, &download); err != nil {
		return nil, fmt.Errorf("failed to parse download: %w", err)
	}

	return &download, nil
}

// UpdateDownload updates a download record
func (m *Manager) UpdateDownload(download *models.Download) error {
	download.UpdatedAt = time.Now()

	// Ensure downloads directory exists
	if err := os.MkdirAll(m.DownloadsDir(), 0755); err != nil {
		return fmt.Errorf("failed to create downloads directory: %w", err)
	}

	data, err := json.MarshalIndent(download, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal download: %w", err)
	}

	path := m.GetDownloadMetadataPath(download.ID)
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write download file: %w", err)
	}

	return nil
}

// ListDownloads returns all downloads
func (m *Manager) ListDownloads() ([]*models.Download, error) {
	downloadsDir := m.DownloadsDir()

	// Create downloads directory if it doesn't exist
	if err := os.MkdirAll(downloadsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create downloads directory: %w", err)
	}

	entries, err := os.ReadDir(downloadsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read downloads directory: %w", err)
	}

	var downloads []*models.Download
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		downloadID := entry.Name()[:len(entry.Name())-5] // Remove .json extension
		download, err := m.GetDownload(downloadID)
		if err != nil {
			m.logger.Warn("Failed to load download", zap.String("id", downloadID), zap.Error(err))
			continue
		}
		downloads = append(downloads, download)
	}

	return downloads, nil
}

// DeleteDownload removes a download record and its file
func (m *Manager) DeleteDownload(id string) error {
	download, err := m.GetDownload(id)
	if err != nil {
		return err
	}

	// Delete video file if exists
	if download.FilePath != "" {
		if err := m.DeleteFile(download.FilePath); err != nil {
			m.logger.Warn("Failed to delete download file", zap.String("path", download.FilePath), zap.Error(err))
		}
	}

	// Delete metadata
	metadataPath := m.GetDownloadMetadataPath(id)
	return m.DeleteFile(metadataPath)
}

// ClearAllDownloads deletes all download records and their files
func (m *Manager) ClearAllDownloads() error {
	downloads, err := m.ListDownloads()
	if err != nil {
		return err
	}

	for _, download := range downloads {
		if err := m.DeleteDownload(download.ID); err != nil {
			m.logger.Warn("Failed to delete download", zap.String("id", download.ID), zap.Error(err))
		}
	}

	return nil
}

// ClearEverything deletes all videos, downloads, projects, outputs, and resets counter
func (m *Manager) ClearEverything() error {
	m.logger.Info("Starting complete cleanup of all data")

	// Delete all downloads
	downloads, err := m.ListDownloads()
	if err == nil {
		for _, download := range downloads {
			if err := m.DeleteDownload(download.ID); err != nil {
				m.logger.Warn("Failed to delete download", zap.String("id", download.ID), zap.Error(err))
			}
		}
	}

	// Delete all video metadata
	videos, err := m.ListVideos()
	if err == nil {
		for _, video := range videos {
			if err := m.DeleteVideo(video.ID); err != nil {
				m.logger.Warn("Failed to delete video", zap.String("id", video.ID), zap.Error(err))
			}
		}
	}

	// Delete all projects
	projects, err := m.ListProjects()
	if err == nil {
		for _, project := range projects {
			if err := m.DeleteProject(project.ID); err != nil {
				m.logger.Warn("Failed to delete project", zap.String("id", project.ID), zap.Error(err))
			}
		}
	}

	// Clear output directory
	outputDir := m.OutputsDir()
	if entries, err := os.ReadDir(outputDir); err == nil {
		for _, entry := range entries {
			path := filepath.Join(outputDir, entry.Name())
			if err := os.Remove(path); err != nil {
				m.logger.Warn("Failed to delete output file", zap.String("path", path), zap.Error(err))
			}
		}
	}

	// Clear temp directory
	tempDir := m.TempDir()
	if entries, err := os.ReadDir(tempDir); err == nil {
		for _, entry := range entries {
			path := filepath.Join(tempDir, entry.Name())
			if err := os.Remove(path); err != nil {
				m.logger.Warn("Failed to delete temp file", zap.String("path", path), zap.Error(err))
			}
		}
	}

	// Reset video counter
	if err := m.ResetVideoCounter(); err != nil {
		m.logger.Warn("Failed to reset video counter", zap.Error(err))
	}

	m.logger.Info("Complete cleanup finished")
	return nil
}

// ListVideos returns all video metadata
func (m *Manager) ListVideos() ([]*models.Video, error) {
	entries, err := os.ReadDir(m.VideosDir())
	if err != nil {
		if os.IsNotExist(err) {
			return []*models.Video{}, nil
		}
		return nil, fmt.Errorf("failed to read videos directory: %w", err)
	}

	videos := make([]*models.Video, 0)
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		videoID := strings.TrimSuffix(entry.Name(), ".json")
		video, err := m.GetVideo(videoID)
		if err != nil {
			m.logger.Warn("Failed to load video", zap.String("id", videoID), zap.Error(err))
			continue
		}

		videos = append(videos, video)
	}

	return videos, nil
}

// ListProjects returns all projects
func (m *Manager) ListProjects() ([]*models.Project, error) {
	entries, err := os.ReadDir(m.ProjectsDir())
	if err != nil {
		if os.IsNotExist(err) {
			return []*models.Project{}, nil
		}
		return nil, fmt.Errorf("failed to read projects directory: %w", err)
	}

	projects := make([]*models.Project, 0)
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".llc" {
			continue
		}

		projectID := strings.TrimSuffix(entry.Name(), ".llc")
		project, err := m.GetProject(projectID)
		if err != nil {
			m.logger.Warn("Failed to load project", zap.String("id", projectID), zap.Error(err))
			continue
		}

		projects = append(projects, project)
	}

	return projects, nil
}

// DeleteProject deletes a project file
func (m *Manager) DeleteProject(projectID string) error {
	projectPath := m.GetProjectPath(projectID)
	return m.DeleteFile(projectPath)
}

// GetVideoMetadataPath returns the path for video metadata JSON
func (m *Manager) GetVideoMetadataPath(videoID string) string {
	return filepath.Join(m.VideosDir(), videoID+".json")
}

// SaveVideo stores video metadata
func (m *Manager) SaveVideo(video *models.Video) error {
	// Ensure videos directory exists
	if err := os.MkdirAll(m.VideosDir(), 0755); err != nil {
		return fmt.Errorf("failed to create videos directory: %w", err)
	}

	data, err := json.MarshalIndent(video, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal video: %w", err)
	}

	path := m.GetVideoMetadataPath(video.ID)
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write video metadata: %w", err)
	}

	return nil
}

// GetVideo retrieves video metadata by ID
func (m *Manager) GetVideo(id string) (*models.Video, error) {
	path := m.GetVideoMetadataPath(id)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("video not found: %s", id)
		}
		return nil, fmt.Errorf("failed to read video: %w", err)
	}

	var video models.Video
	if err := json.Unmarshal(data, &video); err != nil {
		return nil, fmt.Errorf("failed to parse video: %w", err)
	}

	return &video, nil
}

// DeleteVideo removes video metadata and file
func (m *Manager) DeleteVideo(id string) error {
	video, err := m.GetVideo(id)
	if err != nil {
		return err
	}

	// Delete video file if exists
	if video.FilePath != "" {
		if err := m.DeleteFile(video.FilePath); err != nil {
			m.logger.Warn("Failed to delete video file", zap.String("path", video.FilePath), zap.Error(err))
		}
	}

	// Delete metadata
	metadataPath := m.GetVideoMetadataPath(id)
	return m.DeleteFile(metadataPath)
}

// CleanupOldFiles deletes files older than the specified duration
func (m *Manager) CleanupOldFiles(maxAge time.Duration) (int, error) {
	m.logger.Info("Starting cleanup of old files", zap.Duration("maxAge", maxAge))
	cutoffTime := time.Now().Add(-maxAge)
	deletedCount := 0

	// Cleanup videos older than maxAge
	videos, err := m.ListVideos()
	if err == nil {
		for _, video := range videos {
			if video.CreatedAt.Before(cutoffTime) {
				if err := m.DeleteVideo(video.ID); err != nil {
					m.logger.Warn("Failed to delete old video", zap.String("id", video.ID), zap.Error(err))
				} else {
					m.logger.Info("Deleted old video", zap.String("id", video.ID), zap.Time("createdAt", video.CreatedAt))
					deletedCount++
				}
			}
		}
	}

	// Cleanup downloads older than maxAge
	downloads, err := m.ListDownloads()
	if err == nil {
		for _, download := range downloads {
			if download.CreatedAt.Before(cutoffTime) {
				if err := m.DeleteDownload(download.ID); err != nil {
					m.logger.Warn("Failed to delete old download", zap.String("id", download.ID), zap.Error(err))
				} else {
					m.logger.Info("Deleted old download", zap.String("id", download.ID), zap.Time("createdAt", download.CreatedAt))
					deletedCount++
				}
			}
		}
	}

	// Cleanup projects older than maxAge
	projects, err := m.ListProjects()
	if err == nil {
		for _, project := range projects {
			if project.UpdatedAt.Before(cutoffTime) {
				if err := m.DeleteProject(project.ID); err != nil {
					m.logger.Warn("Failed to delete old project", zap.String("id", project.ID), zap.Error(err))
				} else {
					m.logger.Info("Deleted old project", zap.String("id", project.ID), zap.Time("updatedAt", project.UpdatedAt))
					deletedCount++
				}
			}
		}
	}

	// Cleanup old output files
	deletedCount += m.cleanupOldFilesInDir(m.OutputsDir(), cutoffTime)

	// Cleanup old temp files
	deletedCount += m.cleanupOldFilesInDir(m.TempDir(), cutoffTime)

	// Cleanup old screenshots
	deletedCount += m.cleanupOldFilesInDir(m.ScreenshotsDir(), cutoffTime)

	// Cleanup old waveforms
	deletedCount += m.cleanupOldFilesInDir(m.WaveformsDir(), cutoffTime)

	m.logger.Info("Cleanup completed", zap.Int("deletedCount", deletedCount))
	return deletedCount, nil
}

// cleanupOldFilesInDir deletes files in a directory older than cutoffTime
func (m *Manager) cleanupOldFilesInDir(dir string, cutoffTime time.Time) int {
	deleted := 0
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoffTime) {
			if err := os.Remove(path); err != nil {
				m.logger.Warn("Failed to delete old file", zap.String("path", path), zap.Error(err))
			} else {
				m.logger.Info("Deleted old file", zap.String("path", path), zap.Time("modTime", info.ModTime()))
				deleted++
			}
		}
	}
	return deleted
}

package services

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mifi/lossless-cut/backend/internal/config"
	"github.com/mifi/lossless-cut/backend/internal/models"
	"github.com/mifi/lossless-cut/backend/internal/storage"
	"go.uber.org/zap"
)

// DownloadService handles video downloads using yt-dlp
type DownloadService struct {
	storage      *storage.Manager
	videoService *VideoService
	config       *config.Config
	logger       *zap.Logger
	mu           sync.Mutex
	downloads    map[string]*models.Download
}

// NewDownloadService creates a new download service
func NewDownloadService(storage *storage.Manager, videoService *VideoService, cfg *config.Config, logger *zap.Logger) *DownloadService {
	return &DownloadService{
		storage:      storage,
		videoService: videoService,
		config:       cfg,
		logger:       logger,
		downloads:    make(map[string]*models.Download),
	}
}

// DownloadRequest represents a download request
type DownloadRequest struct {
	URL       string `json:"url" binding:"required"`
	Format    string `json:"format,omitempty"` // e.g., "best", "bestvideo+bestaudio", specific format ID
	SessionID string `json:"session_id,omitempty"`
}

// StartDownload initiates a video download
func (s *DownloadService) StartDownload(ctx context.Context, req DownloadRequest) (*models.Download, error) {
	// Create download record with session ID
	download := &models.Download{
		URL:       req.URL,
		SessionID: req.SessionID,
		Status:    models.DownloadStatusPending,
	}

	if err := s.storage.CreateDownload(download); err != nil {
		return nil, fmt.Errorf("failed to create download record: %w", err)
	}

	s.mu.Lock()
	s.downloads[download.ID] = download
	s.mu.Unlock()

	// Start download in background
	videoNumber := s.storage.GetNextVideoNumber()
	go s.runDownload(download.ID, req, videoNumber)

	return download, nil
}

// GetDownload retrieves download status
func (s *DownloadService) GetDownload(id string) (*models.Download, error) {
	s.mu.Lock()
	download, exists := s.downloads[id]
	if exists {
		// Copy fields under lock to avoid data race with the running download goroutine
		snapshot := *download
		s.mu.Unlock()
		return &snapshot, nil
	}
	s.mu.Unlock()

	// Try loading from storage
	return s.storage.GetDownload(id)
}

// ListDownloads returns all downloads
func (s *DownloadService) ListDownloads() ([]*models.Download, error) {
	return s.storage.ListDownloads()
}

// CancelDownload cancels an ongoing download
func (s *DownloadService) CancelDownload(id string) error {
	s.mu.Lock()
	download, exists := s.downloads[id]
	s.mu.Unlock()

	if !exists {
		return fmt.Errorf("download not found or already completed")
	}

	download.Status = models.DownloadStatusCancelled
	if err := s.storage.UpdateDownload(download); err != nil {
		return err
	}

	return nil
}

// isDirectVideoURL checks if the URL points directly to a video file
func (s *DownloadService) isDirectVideoURL(urlStr string) bool {
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return false
	}

	// Get the path without query parameters
	path := strings.ToLower(parsedURL.Path)

	// Check for common video extensions
	videoExts := []string{".mp4", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".flv", ".m4v", ".3gp", ".ts", ".m2ts"}
	for _, ext := range videoExts {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}

	// Also check Content-Type header if no extension match
	// Some CDNs use query params for the filename
	if strings.Contains(urlStr, "response-content-type=") || strings.Contains(urlStr, "content-type=") {
		return true
	}

	return false
}

// runDownload executes the actual download
func (s *DownloadService) runDownload(downloadID string, req DownloadRequest, videoNumber int) {
	s.mu.Lock()
	download := s.downloads[downloadID]
	s.mu.Unlock()

	download.Status = models.DownloadStatusDownloading
	s.storage.UpdateDownload(download)

	// Check if this is a direct video URL (not YouTube/etc)
	if s.isDirectVideoURL(req.URL) {
		s.runDirectDownload(download, req, videoNumber)
		return
	}

	// Use yt-dlp for YouTube and other supported sites
	s.runYtdlpDownload(download, req, videoNumber)
}

// runDirectDownload downloads a video directly from URL using HTTP
func (s *DownloadService) runDirectDownload(download *models.Download, req DownloadRequest, videoNumber int) {
	s.logger.Info("Starting direct HTTP download",
		zap.String("id", download.ID),
		zap.String("url", req.URL),
	)

	// Determine output path
	outputDir := s.storage.GetDownloadPath()
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		s.logger.Error("Failed to create download directory", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}

	// Extract extension from URL or use .mp4 as default
	ext := s.getExtensionFromURL(req.URL)
	outputPath := filepath.Join(outputDir, fmt.Sprintf("video%d%s", videoNumber, ext))

	// Extract filename for title
	download.Title = s.getTitleFromURL(req.URL)
	s.storage.UpdateDownload(download)

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: 30 * time.Minute, // Long timeout for large files
	}

	// Create request
	httpReq, err := http.NewRequest("GET", req.URL, nil)
	if err != nil {
		s.logger.Error("Failed to create HTTP request", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}

	// Add headers to mimic browser
	httpReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	httpReq.Header.Set("Accept", "*/*")
	httpReq.Header.Set("Accept-Language", "en-US,en;q=0.9")
	httpReq.Header.Set("Referer", req.URL)

	// Execute request
	resp, err := client.Do(httpReq)
	if err != nil {
		s.logger.Error("HTTP request failed", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		s.logger.Error("HTTP request returned error status",
			zap.Int("status", resp.StatusCode),
		)
		download.Status = models.DownloadStatusFailed
		download.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, resp.Status)
		s.storage.UpdateDownload(download)
		return
	}

	// Get content length for progress
	contentLength := resp.ContentLength

	// Create output file
	outFile, err := os.Create(outputPath)
	if err != nil {
		s.logger.Error("Failed to create output file", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}
	defer outFile.Close()

	// Download with progress tracking
	var downloaded int64
	buf := make([]byte, 256*1024) // 256KB buffer for faster downloads
	lastProgressUpdate := time.Now()

	for {
		if download.Status == models.DownloadStatusCancelled {
			s.logger.Info("Download cancelled", zap.String("id", download.ID))
			outFile.Close()
			os.Remove(outputPath)
			s.storage.UpdateDownload(download)
			return
		}

		n, err := resp.Body.Read(buf)
		if n > 0 {
			_, writeErr := outFile.Write(buf[:n])
			if writeErr != nil {
				s.logger.Error("Failed to write to file", zap.Error(writeErr))
				download.Status = models.DownloadStatusFailed
				download.Error = writeErr.Error()
				s.storage.UpdateDownload(download)
				return
			}
			downloaded += int64(n)

			// Update progress every 500ms to avoid too many updates
			if contentLength > 0 && time.Since(lastProgressUpdate) > 500*time.Millisecond {
				download.Progress = float64(downloaded) / float64(contentLength) * 100
				s.storage.UpdateDownload(download)
				lastProgressUpdate = time.Now()

				s.logger.Debug("Download progress",
					zap.String("id", download.ID),
					zap.Float64("progress", download.Progress),
					zap.Int64("downloaded", downloaded),
					zap.Int64("total", contentLength),
				)
			}
		}

		if err == io.EOF {
			break
		}
		if err != nil {
			s.logger.Error("Failed to read response body", zap.Error(err))
			download.Status = models.DownloadStatusFailed
			download.Error = err.Error()
			s.storage.UpdateDownload(download)
			return
		}
	}

	download.FilePath = outputPath

	s.logger.Info("Direct download completed",
		zap.String("id", download.ID),
		zap.String("file", outputPath),
		zap.Int64("size", downloaded),
	)

	// Import the downloaded video with session ID
	filename := filepath.Base(outputPath)
	video, err := s.videoService.CreateFromUpload(filename, outputPath, download.SessionID)
	if err != nil {
		s.logger.Error("Failed to import downloaded video", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = fmt.Sprintf("failed to import video: %v", err)
		s.storage.UpdateDownload(download)
		return
	}

	video.OriginalURL = download.URL

	download.VideoID = video.ID
	download.Duration = video.Duration // Pass duration to download status
	download.Title = video.FileName
	download.Status = models.DownloadStatusCompleted
	download.Progress = 100.0
	s.storage.UpdateDownload(download)

	s.logger.Info("Download completed and imported",
		zap.String("id", download.ID),
		zap.String("file", outputPath),
		zap.String("video_id", video.ID),
		zap.Float64("duration", video.Duration),
	)

	// Clean up from memory
	s.mu.Lock()
	delete(s.downloads, download.ID)
	s.mu.Unlock()
}

// getExtensionFromURL extracts file extension from URL
func (s *DownloadService) getExtensionFromURL(urlStr string) string {
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return ".mp4"
	}

	path := parsedURL.Path
	ext := strings.ToLower(filepath.Ext(path))

	// Valid video extensions
	validExts := map[string]bool{
		".mp4": true, ".mov": true, ".mkv": true, ".webm": true,
		".avi": true, ".wmv": true, ".flv": true, ".m4v": true,
		".3gp": true, ".ts": true, ".m2ts": true,
	}

	if validExts[ext] {
		return ext
	}

	// Check query params for filename
	if filename := parsedURL.Query().Get("response-content-disposition"); filename != "" {
		if idx := strings.Index(filename, "filename="); idx >= 0 {
			fn := filename[idx+9:]
			fn = strings.Trim(fn, "\"")
			if e := filepath.Ext(fn); validExts[strings.ToLower(e)] {
				return strings.ToLower(e)
			}
		}
	}

	return ".mp4"
}

// getTitleFromURL extracts a title from the URL
func (s *DownloadService) getTitleFromURL(urlStr string) string {
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return "Downloaded Video"
	}

	// Check for filename in content-disposition query param
	if filename := parsedURL.Query().Get("response-content-disposition"); filename != "" {
		if idx := strings.Index(filename, "filename="); idx >= 0 {
			fn := filename[idx+9:]
			fn = strings.Trim(fn, "\"")
			// Remove extension
			if ext := filepath.Ext(fn); ext != "" {
				fn = fn[:len(fn)-len(ext)]
			}
			return fn
		}
	}

	// Use filename from path
	path := parsedURL.Path
	filename := filepath.Base(path)
	if ext := filepath.Ext(filename); ext != "" {
		filename = filename[:len(filename)-len(ext)]
	}

	if filename != "" && filename != "." {
		return filename
	}

	return "Downloaded Video"
}

// runYtdlpDownload downloads using yt-dlp for YouTube and similar sites
func (s *DownloadService) runYtdlpDownload(download *models.Download, req DownloadRequest, videoNumber int) {
	// Get video info first
	info, err := s.getVideoInfo(req.URL)
	if err != nil {
		s.logger.Error("Failed to get video info", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}

	download.Title = info.Title
	download.Duration = info.Duration
	s.storage.UpdateDownload(download)

	// Determine output path
	outputDir := s.storage.GetDownloadPath()
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		s.logger.Error("Failed to create download directory", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}

	// Use simple sequential naming for easier FFmpeg management
	// For yt-dlp, we need to specify the extension in the template
	// yt-dlp will use the actual video extension (.mp4, .webm, .mkv, etc.)
	outputTemplate := filepath.Join(outputDir, fmt.Sprintf("video%d.%%(ext)s", videoNumber))

	s.logger.Info("Downloading video with simple naming",
		zap.Int("videoNumber", videoNumber),
		zap.String("outputTemplate", outputTemplate),
		zap.String("title", info.Title),
	)

	// Build yt-dlp command
	args := []string{
		"--newline",
		"--no-playlist",
		"--progress",
		"-o", outputTemplate,
	}

	// Add format if specified
	if req.Format != "" {
		args = append(args, "-f", req.Format)
	} else {
		args = append(args, "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best")
	}

	args = append(args, req.URL)

	// Execute yt-dlp
	cmd := exec.Command(s.config.YtDlp.Path, args...)

	// Create pipes for output
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.logger.Error("Failed to create stdout pipe", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.logger.Error("Failed to create stderr pipe", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}

	if err := cmd.Start(); err != nil {
		s.logger.Error("Failed to start yt-dlp", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}

	// Parse progress from stdout
	go s.parseDownloadProgress(stdout, download)

	// Log stderr (with cleanup)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			s.logger.Debug("yt-dlp stderr", zap.String("line", scanner.Text()))
		}
	}()

	// Wait for completion
	if err := cmd.Wait(); err != nil {
		if download.Status == models.DownloadStatusCancelled {
			s.logger.Info("Download cancelled", zap.String("id", download.ID))
			s.storage.UpdateDownload(download)
			wg.Wait()
			return
		}

		s.logger.Error("yt-dlp failed", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = err.Error()
		s.storage.UpdateDownload(download)
		return
	}

	// Find the downloaded file
	// yt-dlp saves with the actual extension (.mp4, .webm, .mkv, etc.)
	// Look for video{N}.* where * is any extension
	pattern := filepath.Join(outputDir, fmt.Sprintf("video%d.*", videoNumber))
	files, err := filepath.Glob(pattern)

	if err != nil {
		s.logger.Error("Failed to glob for downloaded file",
			zap.Error(err),
			zap.String("pattern", pattern),
		)
		download.Status = models.DownloadStatusFailed
		download.Error = fmt.Sprintf("glob error: %v", err)
		s.storage.UpdateDownload(download)
		return
	}

	if len(files) == 0 {
		s.logger.Error("Downloaded file not found",
			zap.String("pattern", pattern),
			zap.Int("videoNumber", videoNumber),
		)
		download.Status = models.DownloadStatusFailed
		download.Error = "downloaded file not found"
		s.storage.UpdateDownload(download)
		return
	}

	downloadedFile := files[0]
	download.FilePath = downloadedFile

	s.logger.Info("Found downloaded file",
		zap.String("file", downloadedFile),
		zap.Int("videoNumber", videoNumber),
		zap.String("extension", filepath.Ext(downloadedFile)),
	)

	// Import the downloaded video with session ID
	filename := filepath.Base(downloadedFile)
	video, err := s.videoService.CreateFromUpload(filename, downloadedFile, download.SessionID)
	if err != nil {
		s.logger.Error("Failed to import downloaded video", zap.Error(err))
		download.Status = models.DownloadStatusFailed
		download.Error = fmt.Sprintf("failed to import video: %v", err)
		s.storage.UpdateDownload(download)
		return
	}

	// Set the original URL
	video.OriginalURL = download.URL

	download.VideoID = video.ID
	download.Duration = video.Duration // Pass duration to download status
	download.Title = video.FileName
	download.Status = models.DownloadStatusCompleted
	download.Progress = 100.0
	s.storage.UpdateDownload(download)

	s.logger.Info("Download completed and imported",
		zap.String("id", download.ID),
		zap.String("file", downloadedFile),
		zap.String("video_id", video.ID),
		zap.Float64("duration", video.Duration),
	)

	// Clean up from memory
	s.mu.Lock()
	delete(s.downloads, download.ID)
	s.mu.Unlock()
}

// parseDownloadProgress parses yt-dlp progress output
func (s *DownloadService) parseDownloadProgress(stdout io.ReadCloser, download *models.Download) {
	scanner := bufio.NewScanner(stdout)
	// Regex to match: [download]  45.2% of 123.45MiB at 1.23MiB/s ETA 00:12
	progressRegex := regexp.MustCompile(`\[download\]\s+(\d+\.?\d*)%`)

	for scanner.Scan() {
		line := scanner.Text()

		if matches := progressRegex.FindStringSubmatch(line); len(matches) > 1 {
			if progress, err := strconv.ParseFloat(matches[1], 64); err == nil {
				download.Progress = progress
				s.storage.UpdateDownload(download)
				s.logger.Debug("Download progress",
					zap.String("id", download.ID),
					zap.Float64("progress", progress),
				)
			}
		}
	}
}

// VideoInfo represents basic video information from yt-dlp
type VideoInfo struct {
	Title    string  `json:"title"`
	Duration float64 `json:"duration"`
	Format   string  `json:"format"`
}

// getVideoInfo retrieves video information without downloading
func (s *DownloadService) getVideoInfo(url string) (*VideoInfo, error) {
	cmd := exec.Command(s.config.YtDlp.Path, "--dump-json", "--no-playlist", url)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get video info: %w", err)
	}

	var info VideoInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return nil, fmt.Errorf("failed to parse video info: %w", err)
	}

	return &info, nil
}

// sanitizeFilename removes invalid characters from filename
func sanitizeFilename(name string) string {
	// Replace invalid characters with underscore
	invalid := regexp.MustCompile(`[<>:"/\\|?*]`)
	sanitized := invalid.ReplaceAllString(name, "_")

	// Limit length
	if len(sanitized) > 200 {
		sanitized = sanitized[:200]
	}

	return strings.TrimSpace(sanitized)
}

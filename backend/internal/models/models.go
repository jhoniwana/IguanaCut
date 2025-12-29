package models

import (
	"time"
)

// Project represents a video editing project
type Project struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	VideoID       string    `json:"video_id"`
	SessionID     string    `json:"session_id,omitempty"` // For user isolation
	Segments      []Segment `json:"segments"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	MediaFileName string    `json:"media_file_name,omitempty"`
}

// Segment represents a time segment in a video
type Segment struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Start    float64           `json:"start"`
	End      *float64          `json:"end,omitempty"`
	Tags     map[string]string `json:"tags,omitempty"`
	Color    int               `json:"color,omitempty"`
	Selected bool              `json:"selected,omitempty"`
}

// Video represents an uploaded or downloaded video
type Video struct {
	ID          string        `json:"id"`
	FileName    string        `json:"file_name"`
	OriginalURL string        `json:"original_url,omitempty"` // For yt-dlp downloads
	FilePath    string        `json:"file_path"`
	FileSize    int64         `json:"file_size"`
	Duration    float64       `json:"duration"`
	Width       int           `json:"width"`
	Height      int           `json:"height"`
	Codec       string        `json:"codec"`
	Format      string        `json:"format"`
	Metadata    VideoMetadata `json:"metadata"`
	SessionID   string        `json:"session_id,omitempty"` // For user isolation
	CreatedAt   time.Time     `json:"created_at"`
}

// VideoMetadata contains FFprobe metadata
type VideoMetadata struct {
	Streams  []Stream  `json:"streams"`
	Format   Format    `json:"format"`
	Chapters []Chapter `json:"chapters,omitempty"`
}

// Stream represents a media stream
type Stream struct {
	Index      int     `json:"index"`
	CodecType  string  `json:"codec_type"`
	CodecName  string  `json:"codec_name"`
	Width      int     `json:"width,omitempty"`
	Height     int     `json:"height,omitempty"`
	Duration   float64 `json:"duration,omitempty"`
	BitRate    int64   `json:"bit_rate,omitempty"`
	SampleRate int     `json:"sample_rate,omitempty"`
	Channels   int     `json:"channels,omitempty"`
	Language   string  `json:"language,omitempty"`
	Title      string  `json:"title,omitempty"`
}

// Format represents the container format
type Format struct {
	FormatName     string  `json:"format_name"`
	FormatLongName string  `json:"format_long_name"`
	Duration       float64 `json:"duration"`
	Size           int64   `json:"size"`
	BitRate        int64   `json:"bit_rate"`
}

// Chapter represents a video chapter
type Chapter struct {
	ID        int     `json:"id"`
	TimeBase  string  `json:"time_base"`
	Start     int64   `json:"start"`
	End       int64   `json:"end"`
	StartTime float64 `json:"start_time"`
	EndTime   float64 `json:"end_time"`
	Title     string  `json:"title,omitempty"`
}

// Operation represents a processing operation
type Operation struct {
	ID          string          `json:"id"`
	Type        OperationType   `json:"type"`
	ProjectID   string          `json:"project_id"`
	Status      OperationStatus `json:"status"`
	Progress    float64         `json:"progress"`
	Error       string          `json:"error,omitempty"`
	OutputFiles []string        `json:"output_files,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	CompletedAt *time.Time      `json:"completed_at,omitempty"`
}

type OperationType string

const (
	OperationTypeCut      OperationType = "cut"
	OperationTypeMerge    OperationType = "merge"
	OperationTypeExport   OperationType = "export"
	OperationTypeSnapshot OperationType = "snapshot"
)

type OperationStatus string

const (
	OperationStatusPending    OperationStatus = "pending"
	OperationStatusProcessing OperationStatus = "processing"
	OperationStatusCompleted  OperationStatus = "completed"
	OperationStatusFailed     OperationStatus = "failed"
)

// DownloadRequest represents a yt-dlp download request
type DownloadRequest struct {
	URL     string `json:"url" binding:"required"`
	Quality string `json:"quality,omitempty"`
}

// UploadResponse represents a successful upload response
type UploadResponse struct {
	VideoID string `json:"video_id"`
	Video   *Video `json:"video"`
}

// ExportRequest represents an export request
type ExportRequest struct {
	Format         string   `json:"format,omitempty"`
	OutputName     string   `json:"output_name,omitempty"`
	SegmentIDs     []string `json:"segment_ids,omitempty"` // If empty, export all
	MergeSegments  bool     `json:"merge_segments,omitempty"`
	ExportSeparate bool     `json:"export_separate,omitempty"` // Export each segment as separate file
	ExportChapters bool     `json:"export_chapters,omitempty"` // Export segments as chapters
	ChaptersFormat string   `json:"chapters_format,omitempty"` // "txt", "xml", "json"
	// Intro/Outro settings
	IntroImagePath string `json:"intro_image_path,omitempty"`
	IntroDuration  int    `json:"intro_duration,omitempty"` // Duration in seconds
	OutroImagePath string `json:"outro_image_path,omitempty"`
	OutroDuration  int    `json:"outro_duration,omitempty"` // Duration in seconds
}

// Download represents a video download from URL
type Download struct {
	ID        string         `json:"id"`
	URL       string         `json:"url"`
	Title     string         `json:"title,omitempty"`
	Duration  float64        `json:"duration,omitempty"`
	Status    DownloadStatus `json:"status"`
	Progress  float64        `json:"progress"`
	FilePath  string         `json:"file_path,omitempty"`
	VideoID   string         `json:"video_id,omitempty"`
	SessionID string         `json:"session_id,omitempty"` // For user isolation
	Error     string         `json:"error,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

type DownloadStatus string

const (
	DownloadStatusPending     DownloadStatus = "pending"
	DownloadStatusDownloading DownloadStatus = "downloading"
	DownloadStatusCompleted   DownloadStatus = "completed"
	DownloadStatusFailed      DownloadStatus = "failed"
	DownloadStatusCancelled   DownloadStatus = "cancelled"
)

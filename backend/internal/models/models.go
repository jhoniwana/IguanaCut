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
	OperationTypePreview  OperationType = "preview"
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

// BlurRegion represents a region to blur in the video
type BlurRegion struct {
	ID            string  `json:"id"`
	X             int     `json:"x"`              // Pixel position
	Y             int     `json:"y"`              // Pixel position
	Width         int     `json:"width"`          // Pixel size
	Height        int     `json:"height"`         // Pixel size
	StartTime     float64 `json:"start_time"`     // When blur starts
	EndTime       float64 `json:"end_time"`       // When blur ends
	BlurIntensity int     `json:"blur_intensity"` // 10-50
}

// DetectionZone represents a circular zone for guided face detection
type DetectionZone struct {
	ID        string  `json:"id"`
	X         int     `json:"x"`          // Center X in pixels
	Y         int     `json:"y"`          // Center Y in pixels
	Radius    int     `json:"radius"`     // Radius in pixels
	StartTime float64 `json:"start_time"` // When zone is active
	EndTime   float64 `json:"end_time"`   // When zone ends
}

// BlurStyleConfig represents the blur style configuration
type BlurStyleConfig struct {
	Style     string `json:"style"`               // "pixelate", "gaussian", "color", "box", "emoji", "image"
	Intensity int    `json:"intensity,omitempty"` // For pixelate/gaussian
	Color     string `json:"color,omitempty"`     // For color style (hex)
	Emoji     string `json:"emoji,omitempty"`     // For emoji style
	ImageData string `json:"imageData,omitempty"` // Base64 image for image style
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
	// Crop settings
	CropEnabled bool   `json:"crop_enabled,omitempty"`
	CropPreset  string `json:"crop_preset,omitempty"` // "tiktok", "instagram", "youtube", "cinema", "portrait43", "free"
	CropX       int    `json:"crop_x,omitempty"`
	CropY       int    `json:"crop_y,omitempty"`
	CropWidth   int    `json:"crop_width,omitempty"`
	CropHeight  int    `json:"crop_height,omitempty"`
	// Blur settings
	BlurMode                string           `json:"blur_mode,omitempty"`                 // "off", "auto", "manual", "guided"
	BlurAutoIntensity       int              `json:"blur_auto_intensity,omitempty"`       // For auto mode
	BlurRegions             []BlurRegion     `json:"blur_regions,omitempty"`              // For manual mode
	DetectionZones          []DetectionZone  `json:"detection_zones,omitempty"`           // For guided mode
	BlurConfirmedSignatures [][]float64      `json:"blur_confirmed_signatures,omitempty"` // User-confirmed face signatures
	BlurPerClip             map[string]bool  `json:"blur_per_clip,omitempty"`             // Per-clip blur enabled/disabled
	BlurStyle               *BlurStyleConfig `json:"blur_style,omitempty"`                // Blur style configuration
	// Watermark settings
	Watermark *WatermarkOptions `json:"watermark,omitempty"` // Watermark overlay configuration
}

// PreviewRequest represents a preview generation request
type PreviewRequest struct {
	VideoID        string          `json:"video_id" binding:"required"`
	StartTime      float64         `json:"start_time"`         // Start time for preview
	Duration       float64         `json:"duration,omitempty"` // Preview duration (default 5s)
	CropEnabled    bool            `json:"crop_enabled,omitempty"`
	CropX          int             `json:"crop_x,omitempty"`
	CropY          int             `json:"crop_y,omitempty"`
	CropWidth      int             `json:"crop_width,omitempty"`
	CropHeight     int             `json:"crop_height,omitempty"`
	BlurMode       string          `json:"blur_mode,omitempty"`
	BlurIntensity  int             `json:"blur_intensity,omitempty"`
	DetectionZones []DetectionZone `json:"detection_zones,omitempty"`
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

// ==================== Multi-Clip Timeline Models ====================

// TimelineClip represents a clip positioned on the timeline
type TimelineClip struct {
	ID               string  `json:"id"`
	SourceVideoID    string  `json:"source_video_id"`
	SourceStart      float64 `json:"source_start"`
	SourceEnd        float64 `json:"source_end"`
	TimelinePosition float64 `json:"timeline_position"`
	TrackIndex       int     `json:"track_index"`
	Name             string  `json:"name"`
	Duration         float64 `json:"duration"` // Computed: SourceEnd - SourceStart
}

// TimelineProject represents a multi-source timeline project
type TimelineProject struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	SessionID     string         `json:"session_id,omitempty"`
	VideoIDs      []string       `json:"video_ids"`      // Multiple video sources
	TimelineClips []TimelineClip `json:"timeline_clips"` // Clips on timeline
	TotalDuration float64        `json:"total_duration"` // Computed total
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

// SourceVideo represents a video source with its metadata for the timeline
type SourceVideo struct {
	Video     *Video `json:"video"`
	Thumbnail string `json:"thumbnail,omitempty"` // Base64 or URL
	Color     string `json:"color,omitempty"`     // Color for timeline clips
}

// CodecInfo contains codec information for compatibility checking
type CodecInfo struct {
	VideoCodec  string `json:"video_codec"`
	AudioCodec  string `json:"audio_codec"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	FrameRate   string `json:"frame_rate"`
	SampleRate  int    `json:"sample_rate"`
	PixelFormat string `json:"pixel_format"`
}

// CodecCompatibility represents the result of codec compatibility check
type CodecCompatibility struct {
	Compatible     bool        `json:"compatible"`
	RequiresEncode bool        `json:"requires_encode"`
	Reason         string      `json:"reason,omitempty"`
	Codecs         []CodecInfo `json:"codecs"`
}

// BatchUploadResponse represents the response for batch upload
type BatchUploadResponse struct {
	Videos  []*Video `json:"videos"`
	Errors  []string `json:"errors,omitempty"`
	Success int      `json:"success"`
	Failed  int      `json:"failed"`
}

// WatermarkOptions contains watermark configuration for export
type WatermarkOptions struct {
	Enabled  bool    `json:"enabled"`
	Filename string  `json:"filename"`
	Position string  `json:"position"` // "top-left", "top-right", "bottom-left", "bottom-right", "center"
	Opacity  float64 `json:"opacity"`
	Scale    float64 `json:"scale"`
	MarginX  int     `json:"margin_x"`
	MarginY  int     `json:"margin_y"`
}

// TimelineExportRequest represents a request to export a timeline project
type TimelineExportRequest struct {
	ProjectID     string   `json:"project_id"`
	ClipIDs       []string `json:"clip_ids,omitempty"` // If empty, export all
	OutputName    string   `json:"output_name,omitempty"`
	Format        string   `json:"format,omitempty"`
	ForceReencode bool     `json:"force_reencode,omitempty"`
	// Inherited from ExportRequest for effects
	CropEnabled bool `json:"crop_enabled,omitempty"`
	CropX       int  `json:"crop_x,omitempty"`
	CropY       int  `json:"crop_y,omitempty"`
	CropWidth   int  `json:"crop_width,omitempty"`
	CropHeight  int  `json:"crop_height,omitempty"`
	// Watermark settings
	Watermark *WatermarkOptions `json:"watermark,omitempty"`
}

// OutputFile represents an exported cut, linked to its source video.
type OutputFile struct {
	FileName  string    `json:"file_name"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
	VideoID   string    `json:"video_id,omitempty"`
}

// outputsIndex is the persisted mapping output file -> source video.
type outputsIndex struct {
	Outputs []OutputFile `json:"outputs"`
}

package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mifi/lossless-cut/backend/internal/models"
	"github.com/mifi/lossless-cut/backend/internal/services"
	"go.uber.org/zap"
)

type TimelineHandler struct {
	services *services.Services
	logger   *zap.Logger
	mu       sync.RWMutex // Protects concurrent access to projects map
	// In-memory storage for timeline projects (could be persisted later)
	projects map[string]*models.TimelineProject
}

func NewTimelineHandler(services *services.Services, logger *zap.Logger) *TimelineHandler {
	return &TimelineHandler{
		services: services,
		logger:   logger,
		projects: make(map[string]*models.TimelineProject),
	}
}

// CreateProject creates a new timeline project
func (h *TimelineHandler) CreateProject(c *gin.Context) {
	var req struct {
		Name     string   `json:"name"`
		VideoIDs []string `json:"video_ids"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sessionID := c.GetHeader("X-Session-ID")

	project := &models.TimelineProject{
		ID:            uuid.New().String(),
		Name:          req.Name,
		SessionID:     sessionID,
		VideoIDs:      req.VideoIDs,
		TimelineClips: []models.TimelineClip{},
		TotalDuration: 0,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	if project.Name == "" {
		project.Name = "Untitled Timeline"
	}

	h.mu.Lock()
	h.projects[project.ID] = project
	h.mu.Unlock()

	h.logger.Info("Timeline project created",
		zap.String("id", project.ID),
		zap.String("name", project.Name),
		zap.Int("videoCount", len(project.VideoIDs)),
	)

	c.JSON(http.StatusCreated, project)
}

// GetProject retrieves a timeline project
func (h *TimelineHandler) GetProject(c *gin.Context) {
	projectID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.RLock()
	project, exists := h.projects[projectID]
	h.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	// Check session ownership
	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	c.JSON(http.StatusOK, project)
}

// ListProjects lists all timeline projects for a session
func (h *TimelineHandler) ListProjects(c *gin.Context) {
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.RLock()
	projects := make([]*models.TimelineProject, 0)
	for _, p := range h.projects {
		if p.SessionID == "" || p.SessionID == sessionID {
			projects = append(projects, p)
		}
	}
	h.mu.RUnlock()

	// Sort by creation date
	sort.Slice(projects, func(i, j int) bool {
		return projects[i].CreatedAt.After(projects[j].CreatedAt)
	})

	c.JSON(http.StatusOK, projects)
}

// UpdateProject updates a timeline project
func (h *TimelineHandler) UpdateProject(c *gin.Context) {
	projectID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.Lock()
	defer h.mu.Unlock()

	project, exists := h.projects[projectID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	var req struct {
		Name          string                `json:"name,omitempty"`
		VideoIDs      []string              `json:"video_ids,omitempty"`
		TimelineClips []models.TimelineClip `json:"timeline_clips,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != "" {
		project.Name = req.Name
	}
	if req.VideoIDs != nil {
		project.VideoIDs = req.VideoIDs
	}
	if req.TimelineClips != nil {
		project.TimelineClips = req.TimelineClips
		// Recalculate total duration
		project.TotalDuration = h.calculateTotalDuration(project.TimelineClips)
	}

	project.UpdatedAt = time.Now()

	c.JSON(http.StatusOK, project)
}

// DeleteProject deletes a timeline project
func (h *TimelineHandler) DeleteProject(c *gin.Context) {
	projectID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.Lock()
	defer h.mu.Unlock()

	project, exists := h.projects[projectID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	delete(h.projects, projectID)

	h.logger.Info("Timeline project deleted", zap.String("id", projectID))

	c.JSON(http.StatusOK, gin.H{"message": "project deleted"})
}

// AddClip adds a clip to the timeline
func (h *TimelineHandler) AddClip(c *gin.Context) {
	projectID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.Lock()
	defer h.mu.Unlock()

	project, exists := h.projects[projectID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	var clip models.TimelineClip
	if err := c.ShouldBindJSON(&clip); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate source video exists
	_, err := h.services.Video.GetVideo(clip.SourceVideoID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source video not found"})
		return
	}

	// Generate ID if not provided
	if clip.ID == "" {
		clip.ID = uuid.New().String()
	}

	// Calculate duration
	clip.Duration = clip.SourceEnd - clip.SourceStart

	// Calculate timeline position (at end of timeline)
	if clip.TimelinePosition == 0 {
		clip.TimelinePosition = project.TotalDuration
	}

	project.TimelineClips = append(project.TimelineClips, clip)
	project.TotalDuration = h.calculateTotalDuration(project.TimelineClips)
	project.UpdatedAt = time.Now()

	// Add video to project's video list if not already there
	found := false
	for _, vid := range project.VideoIDs {
		if vid == clip.SourceVideoID {
			found = true
			break
		}
	}
	if !found {
		project.VideoIDs = append(project.VideoIDs, clip.SourceVideoID)
	}

	h.logger.Info("Clip added to timeline",
		zap.String("projectId", projectID),
		zap.String("clipId", clip.ID),
		zap.Float64("duration", clip.Duration),
	)

	c.JSON(http.StatusCreated, clip)
}

// UpdateClip updates a clip in the timeline
func (h *TimelineHandler) UpdateClip(c *gin.Context) {
	projectID := c.Param("id")
	clipID := c.Param("clipId")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.Lock()
	defer h.mu.Unlock()

	project, exists := h.projects[projectID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	var update models.TimelineClip
	if err := c.ShouldBindJSON(&update); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Find and update the clip
	found := false
	for i, clip := range project.TimelineClips {
		if clip.ID == clipID {
			update.ID = clipID
			update.Duration = update.SourceEnd - update.SourceStart
			project.TimelineClips[i] = update
			found = true
			break
		}
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "clip not found"})
		return
	}

	project.TotalDuration = h.calculateTotalDuration(project.TimelineClips)
	project.UpdatedAt = time.Now()

	c.JSON(http.StatusOK, update)
}

// DeleteClip removes a clip from the timeline
func (h *TimelineHandler) DeleteClip(c *gin.Context) {
	projectID := c.Param("id")
	clipID := c.Param("clipId")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.Lock()
	defer h.mu.Unlock()

	project, exists := h.projects[projectID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	// Find and remove the clip
	found := false
	newClips := make([]models.TimelineClip, 0, len(project.TimelineClips)-1)
	for _, clip := range project.TimelineClips {
		if clip.ID == clipID {
			found = true
			continue
		}
		newClips = append(newClips, clip)
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "clip not found"})
		return
	}

	project.TimelineClips = newClips
	project.TotalDuration = h.calculateTotalDuration(project.TimelineClips)
	project.UpdatedAt = time.Now()

	h.logger.Info("Clip removed from timeline",
		zap.String("projectId", projectID),
		zap.String("clipId", clipID),
	)

	c.JSON(http.StatusOK, gin.H{"message": "clip deleted"})
}

// ReorderClips reorders clips in the timeline
func (h *TimelineHandler) ReorderClips(c *gin.Context) {
	projectID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.Lock()
	defer h.mu.Unlock()

	project, exists := h.projects[projectID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	var req struct {
		ClipIDs []string `json:"clip_ids" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Create map of existing clips
	clipMap := make(map[string]models.TimelineClip)
	for _, clip := range project.TimelineClips {
		clipMap[clip.ID] = clip
	}

	// Reorder clips based on new order
	newClips := make([]models.TimelineClip, 0, len(req.ClipIDs))
	timelinePos := 0.0

	for _, clipID := range req.ClipIDs {
		clip, exists := clipMap[clipID]
		if !exists {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("clip %s not found", clipID)})
			return
		}
		clip.TimelinePosition = timelinePos
		timelinePos += clip.Duration
		newClips = append(newClips, clip)
	}

	project.TimelineClips = newClips
	project.TotalDuration = timelinePos
	project.UpdatedAt = time.Now()

	c.JSON(http.StatusOK, project)
}

// Export exports the timeline project
func (h *TimelineHandler) Export(c *gin.Context) {
	projectID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.RLock()
	project, exists := h.projects[projectID]
	h.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	if len(project.TimelineClips) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no clips to export"})
		return
	}

	var req models.TimelineExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Use defaults
		req.ProjectID = projectID
	}
	req.ProjectID = projectID

	// Start export operation
	operationID, err := h.services.Operation.ExportTimeline(project, &req)
	if err != nil {
		h.logger.Error("Failed to start timeline export",
			zap.String("projectId", projectID),
			zap.Error(err),
		)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start export"})
		return
	}

	h.logger.Info("Timeline export started",
		zap.String("projectId", projectID),
		zap.String("operationId", operationID),
		zap.Int("clipCount", len(project.TimelineClips)),
	)

	c.JSON(http.StatusAccepted, gin.H{
		"operation_id": operationID,
		"message":      "export started",
	})
}

// Helper function to calculate total timeline duration
func (h *TimelineHandler) calculateTotalDuration(clips []models.TimelineClip) float64 {
	if len(clips) == 0 {
		return 0
	}

	// Sort clips by timeline position
	sorted := make([]models.TimelineClip, len(clips))
	copy(sorted, clips)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].TimelinePosition < sorted[j].TimelinePosition
	})

	// Calculate total as end of last clip
	lastClip := sorted[len(sorted)-1]
	return lastClip.TimelinePosition + lastClip.Duration
}

// AddVideoSource adds a new video source to the project
func (h *TimelineHandler) AddVideoSource(c *gin.Context) {
	projectID := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.Lock()
	defer h.mu.Unlock()

	project, exists := h.projects[projectID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	var req struct {
		VideoID string `json:"video_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate video exists
	video, err := h.services.Video.GetVideo(req.VideoID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video not found"})
		return
	}

	// Check if already added
	for _, vid := range project.VideoIDs {
		if vid == req.VideoID {
			c.JSON(http.StatusConflict, gin.H{"error": "video already in project"})
			return
		}
	}

	project.VideoIDs = append(project.VideoIDs, req.VideoID)
	project.UpdatedAt = time.Now()

	c.JSON(http.StatusOK, gin.H{
		"message": "video added",
		"video":   video,
	})
}

// RemoveVideoSource removes a video source from the project
func (h *TimelineHandler) RemoveVideoSource(c *gin.Context) {
	projectID := c.Param("id")
	videoID := c.Param("videoId")
	sessionID := c.GetHeader("X-Session-ID")

	h.mu.Lock()
	defer h.mu.Unlock()

	project, exists := h.projects[projectID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if project.SessionID != "" && project.SessionID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized"})
		return
	}

	// Check if any clips use this video
	for _, clip := range project.TimelineClips {
		if clip.SourceVideoID == videoID {
			c.JSON(http.StatusConflict, gin.H{"error": "cannot remove video that has clips in timeline"})
			return
		}
	}

	// Remove from video list
	newVideos := make([]string, 0, len(project.VideoIDs)-1)
	found := false
	for _, vid := range project.VideoIDs {
		if vid == videoID {
			found = true
			continue
		}
		newVideos = append(newVideos, vid)
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "video not in project"})
		return
	}

	project.VideoIDs = newVideos
	project.UpdatedAt = time.Now()

	c.JSON(http.StatusOK, gin.H{"message": "video removed"})
}

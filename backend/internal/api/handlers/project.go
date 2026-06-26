package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mifi/lossless-cut/backend/internal/models"
	"github.com/mifi/lossless-cut/backend/internal/services"
	"go.uber.org/zap"
)

type ProjectHandler struct {
	services *services.Services
	logger   *zap.Logger
}

func NewProjectHandler(services *services.Services, logger *zap.Logger) *ProjectHandler {
	return &ProjectHandler{
		services: services,
		logger:   logger,
	}
}

func (h *ProjectHandler) Create(c *gin.Context) {
	var req struct {
		Name    string `json:"name" binding:"required"`
		VideoID string `json:"video_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get session ID from header
	sessionID := c.GetHeader("X-Session-ID")

	project, err := h.services.Project.CreateWithSession(req.Name, req.VideoID, sessionID)
	if err != nil {
		h.logger.Error("Failed to create project", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create project"})
		return
	}

	c.JSON(http.StatusCreated, project)
}

func (h *ProjectHandler) List(c *gin.Context) {
	sessionID := c.GetHeader("X-Session-ID")

	projects, err := h.services.Project.List()
	if err != nil {
		h.logger.Error("Failed to list projects", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list projects"})
		return
	}

	// Filter by session ID (keep legacy projects with no session set)
	filtered := make([]*models.Project, 0, len(projects))
	for _, p := range projects {
		if p.SessionID == "" || p.SessionID == sessionID {
			filtered = append(filtered, p)
		}
	}

	c.JSON(http.StatusOK, filtered)
}

func (h *ProjectHandler) Get(c *gin.Context) {
	id := c.Param("id")
	sessionID := c.GetHeader("X-Session-ID")

	project, err := h.services.Project.Get(id)
	if err != nil {
		h.logger.Error("Failed to get project", zap.String("id", id), zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	// Check session ownership (legacy projects with no session set remain accessible)
	if project.SessionID != "" && project.SessionID != sessionID {
		h.logger.Warn("Unauthorized project access attempt",
			zap.String("projectID", id),
			zap.String("projectSession", project.SessionID),
			zap.String("requestSession", sessionID),
		)
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to access this project"})
		return
	}

	c.JSON(http.StatusOK, project)
}

func (h *ProjectHandler) Update(c *gin.Context) {
	id := c.Param("id")

	var project models.Project
	if err := c.ShouldBindJSON(&project); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	project.ID = id
	if err := h.services.Project.Save(&project); err != nil {
		h.logger.Error("Failed to update project", zap.String("id", id), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update project"})
		return
	}

	c.JSON(http.StatusOK, project)
}

func (h *ProjectHandler) Delete(c *gin.Context) {
	id := c.Param("id")

	if err := h.services.Project.Delete(id); err != nil {
		h.logger.Error("Failed to delete project", zap.String("id", id), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "project deleted"})
}

func (h *ProjectHandler) AddSegment(c *gin.Context) {
	projectID := c.Param("id")

	var segment models.Segment
	if err := c.ShouldBindJSON(&segment); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.services.Project.AddSegment(projectID, segment); err != nil {
		h.logger.Error("Failed to add segment", zap.String("projectId", projectID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add segment"})
		return
	}

	c.JSON(http.StatusCreated, segment)
}

func (h *ProjectHandler) UpdateSegment(c *gin.Context) {
	projectID := c.Param("id")
	segmentID := c.Param("segmentId")

	var segment models.Segment
	if err := c.ShouldBindJSON(&segment); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.services.Project.UpdateSegment(projectID, segmentID, segment); err != nil {
		h.logger.Error("Failed to update segment", zap.String("projectId", projectID), zap.String("segmentId", segmentID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update segment"})
		return
	}

	c.JSON(http.StatusOK, segment)
}

func (h *ProjectHandler) DeleteSegment(c *gin.Context) {
	projectID := c.Param("id")
	segmentID := c.Param("segmentId")

	if err := h.services.Project.DeleteSegment(projectID, segmentID); err != nil {
		h.logger.Error("Failed to delete segment", zap.String("projectId", projectID), zap.String("segmentId", segmentID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete segment"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "segment deleted"})
}

func (h *ProjectHandler) Export(c *gin.Context) {
	projectID := c.Param("id")

	var req models.ExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	project, err := h.services.Project.Get(projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	operation, err := h.services.Operation.Export(project, req)
	if err != nil {
		h.logger.Error("Failed to export project", zap.String("projectId", projectID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to export project"})
		return
	}

	c.JSON(http.StatusAccepted, operation)
}

// Preview generates a short preview video with effects applied
func (h *ProjectHandler) Preview(c *gin.Context) {
	var req models.PreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	operation, err := h.services.Operation.GeneratePreview(req)
	if err != nil {
		h.logger.Error("Failed to generate preview", zap.String("videoId", req.VideoID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate preview"})
		return
	}

	c.JSON(http.StatusAccepted, operation)
}

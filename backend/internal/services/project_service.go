package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/mifi/lossless-cut/backend/internal/models"
	"github.com/mifi/lossless-cut/backend/internal/storage"
	"go.uber.org/zap"
)

type ProjectService struct {
	storage *storage.Manager
	logger  *zap.Logger
}

func NewProjectService(storage *storage.Manager, logger *zap.Logger) *ProjectService {
	return &ProjectService{
		storage: storage,
		logger:  logger,
	}
}

func (s *ProjectService) Create(name string, videoID string) (*models.Project, error) {
	return s.CreateWithSession(name, videoID, "")
}

func (s *ProjectService) CreateWithSession(name string, videoID string, sessionID string) (*models.Project, error) {
	project := &models.Project{
		ID:        uuid.New().String(),
		Name:      name,
		VideoID:   videoID,
		SessionID: sessionID,
		Segments:  []models.Segment{},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.Save(project); err != nil {
		return nil, fmt.Errorf("failed to save project: %w", err)
	}

	s.logger.Info("Created project", zap.String("id", project.ID), zap.String("name", name), zap.String("sessionID", sessionID))
	return project, nil
}

func (s *ProjectService) Get(id string) (*models.Project, error) {
	path := s.storage.GetProjectPath(id)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("project not found: %s", id)
		}
		return nil, fmt.Errorf("failed to read project: %w", err)
	}

	var project models.Project
	if err := json.Unmarshal(data, &project); err != nil {
		return nil, fmt.Errorf("failed to parse project: %w", err)
	}

	return &project, nil
}

func (s *ProjectService) List() ([]*models.Project, error) {
	projectsDir := s.storage.ProjectsDir()
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read projects directory: %w", err)
	}

	var projects []*models.Project
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".llc" {
			continue
		}

		projectID := entry.Name()[:len(entry.Name())-4] // Remove .llc extension
		project, err := s.Get(projectID)
		if err != nil {
			s.logger.Warn("Failed to load project", zap.String("id", projectID), zap.Error(err))
			continue
		}
		projects = append(projects, project)
	}

	return projects, nil
}

func (s *ProjectService) Save(project *models.Project) error {
	project.UpdatedAt = time.Now()

	// Ensure projects directory exists
	if err := os.MkdirAll(s.storage.ProjectsDir(), 0755); err != nil {
		return fmt.Errorf("failed to create projects directory: %w", err)
	}

	data, err := json.MarshalIndent(project, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal project: %w", err)
	}

	path := s.storage.GetProjectPath(project.ID)
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write project file: %w", err)
	}

	return nil
}

func (s *ProjectService) Delete(id string) error {
	path := s.storage.GetProjectPath(id)
	if err := s.storage.DeleteFile(path); err != nil {
		return fmt.Errorf("failed to delete project: %w", err)
	}

	s.logger.Info("Deleted project", zap.String("id", id))
	return nil
}

func (s *ProjectService) AddSegment(projectID string, segment models.Segment) error {
	project, err := s.Get(projectID)
	if err != nil {
		return err
	}

	if segment.ID == "" {
		segment.ID = uuid.New().String()
	}

	project.Segments = append(project.Segments, segment)
	return s.Save(project)
}

func (s *ProjectService) UpdateSegment(projectID string, segmentID string, updates models.Segment) error {
	project, err := s.Get(projectID)
	if err != nil {
		return err
	}

	found := false
	for i, seg := range project.Segments {
		if seg.ID == segmentID {
			// Preserve ID
			updates.ID = segmentID
			project.Segments[i] = updates
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("segment not found: %s", segmentID)
	}

	return s.Save(project)
}

func (s *ProjectService) DeleteSegment(projectID string, segmentID string) error {
	project, err := s.Get(projectID)
	if err != nil {
		return err
	}

	segments := make([]models.Segment, 0, len(project.Segments))
	for _, seg := range project.Segments {
		if seg.ID != segmentID {
			segments = append(segments, seg)
		}
	}

	project.Segments = segments
	return s.Save(project)
}

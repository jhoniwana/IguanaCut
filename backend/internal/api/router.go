package api

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/mifi/lossless-cut/backend/internal/api/handlers"
	"github.com/mifi/lossless-cut/backend/internal/api/middleware"
	"github.com/mifi/lossless-cut/backend/internal/config"
	"github.com/mifi/lossless-cut/backend/internal/services"
	"go.uber.org/zap"
)

func NewRouter(services *services.Services, cfg *config.Config, logger *zap.Logger) *gin.Engine {
	router := gin.New()

	// Middleware
	router.Use(gin.Recovery())
	router.Use(middleware.Logger(logger))

	// Los elementos nativos (<video>, <img>) no pueden enviar headers,
	// asi que el frontend adjunta la sesion como ?session= en la URL.
	// Normalizarla a X-Session-ID para que los handlers la vean igual.
	router.Use(func(c *gin.Context) {
		if c.GetHeader("X-Session-ID") == "" {
			if s := c.Query("session"); s != "" {
				c.Request.Header.Set("X-Session-ID", s)
			}
		}
		c.Next()
	})

	// CORS
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = cfg.Server.CorsOrigins
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "X-Session-ID"}
	router.Use(cors.New(corsConfig))

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// API routes
	api := router.Group("/api")
	{
		// System endpoints
		system := api.Group("/system")
		{
			systemHandler := handlers.NewSystemHandler(cfg, services, logger)
			system.GET("/info", systemHandler.Info)
			system.GET("/stats", systemHandler.GetStats)
			system.DELETE("/clear-all", systemHandler.ClearAll)
			system.POST("/session/start", systemHandler.SessionStart)
			system.POST("/session/heartbeat", systemHandler.SessionHeartbeat)
			system.POST("/session/end", systemHandler.SessionEnd)
		}

		// Project endpoints
		projects := api.Group("/projects")
		{
			projectHandler := handlers.NewProjectHandler(services, logger)
			projects.POST("", projectHandler.Create)
			projects.GET("", projectHandler.List)
			projects.GET("/:id", projectHandler.Get)
			projects.PUT("/:id", projectHandler.Update)
			projects.DELETE("/:id", projectHandler.Delete)
			projects.POST("/:id/export", projectHandler.Export)

			// Segment endpoints
			segments := projects.Group("/:id/segments")
			{
				segments.POST("", projectHandler.AddSegment)
				segments.PUT("/:segmentId", projectHandler.UpdateSegment)
				segments.DELETE("/:segmentId", projectHandler.DeleteSegment)
			}
		}

		// Preview endpoint - generates short video preview with effects
		{
			projectHandler := handlers.NewProjectHandler(services, logger)
			api.POST("/preview", projectHandler.Preview)
		}

		// Video endpoints
		videos := api.Group("/videos")
		{
			videoHandler := handlers.NewVideoHandler(services, cfg, logger)
			videos.GET("", videoHandler.List)
			videos.POST("/upload", videoHandler.Upload)
			videos.POST("/batch-upload", videoHandler.BatchUpload)
			videos.POST("/check-compat", videoHandler.CheckCodecCompatibility)
			videos.POST("/download", videoHandler.Download)
			videos.GET("/:id/stream", videoHandler.Stream)
			videos.GET("/:id/waveform", videoHandler.Waveform)
			videos.GET("/:id/thumbnail", videoHandler.Thumbnail)
			videos.POST("/:id/screenshot", videoHandler.Screenshot)
			videos.POST("/:id/detect-faces", videoHandler.DetectFaces)
			videos.PUT("/:id", videoHandler.Rename)
			videos.DELETE("/:id", videoHandler.Delete)
		}

		// Watermark endpoints
		watermarks := api.Group("/watermarks")
		{
			videoHandler := handlers.NewVideoHandler(services, cfg, logger)
			watermarks.POST("/upload", videoHandler.WatermarkUpload)
			watermarks.GET("/:filename", videoHandler.WatermarkServe)
			watermarks.DELETE("/:filename", videoHandler.WatermarkDelete)
		}

		// Timeline endpoints (Multi-clip editing)
		timeline := api.Group("/timeline")
		{
			timelineHandler := handlers.NewTimelineHandler(services, logger)
			// Projects
			timeline.POST("/projects", timelineHandler.CreateProject)
			timeline.GET("/projects", timelineHandler.ListProjects)
			timeline.GET("/projects/:id", timelineHandler.GetProject)
			timeline.PUT("/projects/:id", timelineHandler.UpdateProject)
			timeline.DELETE("/projects/:id", timelineHandler.DeleteProject)
			// Clips
			timeline.POST("/projects/:id/clips", timelineHandler.AddClip)
			timeline.PUT("/projects/:id/clips/:clipId", timelineHandler.UpdateClip)
			timeline.DELETE("/projects/:id/clips/:clipId", timelineHandler.DeleteClip)
			timeline.POST("/projects/:id/reorder", timelineHandler.ReorderClips)
			// Sources
			timeline.POST("/projects/:id/sources", timelineHandler.AddVideoSource)
			timeline.DELETE("/projects/:id/sources/:videoId", timelineHandler.RemoveVideoSource)
			// Export
			timeline.POST("/projects/:id/export", timelineHandler.Export)
		}

		// Screenshot downloads
		api.GET("/screenshots/:filename", func(c *gin.Context) {
			filename := filepath.Base(c.Param("filename"))
			filepath := services.Storage.GetScreenshotPath(filename)

			if !services.Storage.FileExists(filepath) {
				logger.Warn("Screenshot not found", zap.String("filename", filename))
				c.JSON(404, gin.H{"error": "screenshot not found"})
				return
			}

			c.Header("Content-Type", "image/jpeg")
			c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
			c.File(filepath)
		})

		// Download endpoints (dedicated yt-dlp functionality)
		downloads := api.Group("/downloads")
		{
			downloadHandler := handlers.NewDownloadHandler(services, logger)
			downloads.POST("", downloadHandler.Start)
			downloads.GET("", downloadHandler.List)
			downloads.DELETE("", downloadHandler.ClearAll)
			downloads.GET("/:id", downloadHandler.Get)
			downloads.POST("/:id/cancel", downloadHandler.Cancel)
		}

		// Operation endpoints (for checking export/processing status)
		operations := api.Group("/operations")
		{
			operationHandler := handlers.NewOperationHandler(services, logger)
			operations.GET("/:id", operationHandler.GetStatus)
		}

		// Output file downloads (exported videos) - optimized with better headers
		// Listar archivos exportados (cortos)
		api.GET("/outputs", func(c *gin.Context) {
			dir := services.Storage.OutputsDir()
			entries, err := os.ReadDir(dir)
			if err != nil {
				logger.Warn("Cannot list outputs", zap.String("dir", dir), zap.Error(err))
				c.JSON(500, gin.H{"error": "cannot list outputs"})
				return
			}
			outputs := []gin.H{}
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				info, err := e.Info()
				if err != nil {
					continue
				}
				outputs = append(outputs, gin.H{
					"file_name":  e.Name(),
					"size":       info.Size(),
					"created_at": info.ModTime().Format(time.RFC3339),
				})
			}
			c.JSON(200, gin.H{"outputs": outputs})
		})

		// Borrar un archivo exportado
		api.DELETE("/outputs/:filename", func(c *gin.Context) {
			filename := filepath.Base(c.Param("filename"))
			filepath := services.Storage.GetOutputPath(filename)
			if !services.Storage.FileExists(filepath) {
				c.JSON(404, gin.H{"error": "file not found"})
				return
			}
			if err := os.Remove(filepath); err != nil {
				logger.Warn("Cannot delete output", zap.String("filename", filename), zap.Error(err))
				c.JSON(500, gin.H{"error": "cannot delete file"})
				return
			}
			logger.Info("Deleted output", zap.String("filename", filename))
			c.JSON(200, gin.H{"status": "deleted"})
		})

		api.GET("/outputs/:filename", func(c *gin.Context) {
			filename := filepath.Base(c.Param("filename"))
			filepath := services.Storage.GetOutputPath(filename)

			if !services.Storage.FileExists(filepath) {
				logger.Warn("Output file not found", zap.String("filename", filename))
				c.JSON(404, gin.H{"error": "file not found"})
				return
			}

			// Add performance optimization headers
			c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
			c.Header("Cache-Control", "public, max-age=3600") // Cache for 1 hour
			c.Header("X-Content-Type-Options", "nosniff")

			logger.Info("Serving output file", zap.String("filename", filename))
			c.File(filepath)
		})
	}

	// Serve frontend static files (absolute path)
	webDir := filepath.Join(cfg.Storage.BasePath, "..", "backend", "web")
	if _, err := os.Stat(webDir); os.IsNotExist(err) {
		webDir = "./web"
	}
	router.Static("/assets", filepath.Join(webDir, "assets"))
	// Estaticos de la raiz (logo.svg, favicon, ...) con content-type correcto.
	// (Un Static("/") catch-all choca con /assets en gin: StaticFile por
	// archivo + el NoRoute de abajo como SPA fallback.)
	if entries, err := os.ReadDir(webDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || e.Name() == "index.html" {
				continue
			}
			router.StaticFile("/"+e.Name(), filepath.Join(webDir, e.Name()))
		}
	}
	router.StaticFile("/", filepath.Join(webDir, "index.html"))
	router.StaticFile("/index.html", filepath.Join(webDir, "index.html"))

	// Catch-all for SPA routing
	router.NoRoute(func(c *gin.Context) {
		c.File(filepath.Join(webDir, "index.html"))
	})

	return router
}

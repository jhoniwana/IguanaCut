package main

import (
	"flag"
	"fmt"
	"net/http"

	"github.com/mifi/lossless-cut/backend/internal/api"
	"github.com/mifi/lossless-cut/backend/internal/config"
	"github.com/mifi/lossless-cut/backend/internal/services"
	"github.com/mifi/lossless-cut/backend/internal/storage"
	"go.uber.org/zap"
)

func main() {
	configPath := flag.String("config", "", "Path to config file")
	flag.Parse()

	logger, _ := zap.NewProduction()
	defer logger.Sync()

	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Fatal("Failed to load config", zap.Error(err))
	}

	store := storage.NewManager(cfg.Storage.BasePath, logger)
	if err := store.Initialize(); err != nil {
		logger.Fatal("Failed to initialize storage", zap.Error(err))
	}

	svc := services.NewServices(store, cfg, logger)
	router := api.NewRouter(svc, cfg, logger)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	logger.Info("Starting LosslessCut server",
		zap.String("address", addr),
		zap.String("storage", cfg.Storage.BasePath),
	)

	server := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  0,
		WriteTimeout: 0,
	}

	if err := server.ListenAndServe(); err != nil {
		logger.Fatal("Server failed", zap.Error(err))
	}
}

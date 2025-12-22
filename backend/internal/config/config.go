package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/viper"
)

type Config struct {
	Server  ServerConfig  `mapstructure:"server"`
	Storage StorageConfig `mapstructure:"storage"`
	FFmpeg  FFmpegConfig  `mapstructure:"ffmpeg"`
	YtDlp   YtDlpConfig   `mapstructure:"ytdlp"`
}

type ServerConfig struct {
	Host          string   `mapstructure:"host"`
	Port          int      `mapstructure:"port"`
	MaxUploadSize int64    `mapstructure:"max_upload_size"`
	Production    bool     `mapstructure:"production"`
	CorsOrigins   []string `mapstructure:"cors_origins"`
}

type StorageConfig struct {
	BasePath         string `mapstructure:"base_path"`
	AutoCleanup      bool   `mapstructure:"auto_cleanup"`
	CleanupAfterDays int    `mapstructure:"cleanup_after_days"`
}

type FFmpegConfig struct {
	Path    string `mapstructure:"path"`
	Threads int    `mapstructure:"threads"`
}

type YtDlpConfig struct {
	Path       string `mapstructure:"path"`
	MaxQuality string `mapstructure:"max_quality"`
}

func Load(configPath string) (*Config, error) {
	v := viper.New()

	// Set defaults
	setDefaults(v)

	// If config path is provided, use it
	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		// Look for config in default locations
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath(".")
		v.AddConfigPath("/etc/losslesscut/")
		v.AddConfigPath(filepath.Join(os.Getenv("HOME"), ".losslesscut"))
	}

	// Read environment variables
	v.SetEnvPrefix("LOSSLESSCUT")
	v.AutomaticEnv()

	// Read config file
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config: %w", err)
		}
		// Config file not found, use defaults
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// Expand storage path
	if cfg.Storage.BasePath == "" {
		cfg.Storage.BasePath = "/var/losslesscut"
	}
	cfg.Storage.BasePath = os.ExpandEnv(cfg.Storage.BasePath)

	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	// Server defaults
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.port", 8082)
	v.SetDefault("server.max_upload_size", 10737418240) // 10GB
	v.SetDefault("server.production", false)
	v.SetDefault("server.cors_origins", []string{"*"})

	// Storage defaults
	v.SetDefault("storage.base_path", "/var/losslesscut")
	v.SetDefault("storage.auto_cleanup", true)
	v.SetDefault("storage.cleanup_after_days", 7)

	// FFmpeg defaults
	v.SetDefault("ffmpeg.path", "ffmpeg")
	v.SetDefault("ffmpeg.threads", 0) // auto

	// yt-dlp defaults
	v.SetDefault("ytdlp.path", "yt-dlp")
	v.SetDefault("ytdlp.max_quality", "1080p")
}

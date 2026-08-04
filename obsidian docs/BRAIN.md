# 🧠 BRAIN.md — LosslessCut Web Edition

> Compendio integral del proyecto. Cada archivo, cada estructura, cada decisión.
> Última actualización: 2026-08-04

**Notas del vault**: [[_index|MOC]] | [[LosslessCut Web]] | [[Known Issues]] | [[Theme — Purple]]

---

## 📋 Índice

1. [Visión General](#1-visión-general)
2. [Árbol del Proyecto](#2-árbol-del-proyecto)
3. [Backend (Go)](#3-backend-go)
   - [Entry Point](#31-entry-point)
   - [Configuración](#32-configuración)
   - [API Router + Endpoints](#33-api-router--endpoints)
   - [Modelos de Datos](#34-modelos-de-datos)
   - [Servicios](#35-servicios)
   - [FFmpeg / FFprobe Wrapper](#36-ffmpeg--ffprobe-wrapper)
   - [Almacenamiento](#37-almacenamiento)
   - [Handlers HTTP](#38-handlers-http)
4. [Frontend (React + TypeScript)](#4-frontend-react--typescript)
   - [Entry Points](#41-entry-points)
   - [Componentes](#42-componentes)
   - [Hooks](#43-hooks)
   - [Utilidades y Tipos](#44-utilidades-y-tipos)
   - [Build (Vite)](#45-build-vite)
5. [App Android](#5-app-android)
   - [Arquitectura](#51-arquitectura)
   - [Ciclo de Vida](#52-ciclo-de-vida)
   - [Flavors](#53-flavors)
6. [Docker & Producción](#6-docker--producción)
7. [Scripts y Herramientas](#7-scripts-y-herramientas)
8. [Workflows y Flujos Clave](#8-workflows-y-flujos-clave)
9. [Rendimiento y Optimización](#9-rendimiento-y-optimización)
10. [Glosario de Archivos](#10-glosario-de-archivos)

---

## 1. Visión General

**LosslessCut Web Edition** es una herramienta de edición de video/audio sin pérdida (lossless) basada en web.

- **Stack**: Go 1.21+ (backend) + React 18 + TypeScript (frontend) + FFmpeg 6.0+ (procesamiento)
- **Licencia**: GPL-2.0-only
- **Puertos**:
  - Desarrollo frontend: `3001` (Vite con hot reload, proxy a `:8090`)
  - Producción: `8080` (Go sirve frontend + API)
  - Android: `8090` (localhost interno)
- **Funcionalidades principales**:
  - Corte lossless de video/audio (sin re-codificar)
  - Flujo de trabajo I/O (I = Inicio, O = Fin + crear clip)
  - Visualización de waveform
  - Edición multi-segmento con merge/export
  - Descarga de YouTube/URLs vía yt-dlp
  - Gestión de sesiones (save/load projects)
  - Línea de tiempo multi-clip con múltiples fuentes
  - Detección y blur de rostros (Python/OpenCV)
  - Detección de escenas (cortes, negros, silencios)
  - Captura de screenshots
  - Watermark, crop, intro/outro
  - Interfaz responsive con tema oscuro (TikTok-inspired) — ver [[Theme — Purple]] para la paleta
  - App nativa Android (WebView + Go embedded)

---

## 2. Árbol del Proyecto

```
losslesscut/
├── README.md                      # Documentación principal
├── CLAUDE.md                      # Instrucciones para Claude Code
├── GEMINI.md                      # Instrucciones para Gemini
├── BRAIN.md                       # Este archivo
├── IMPLEMENTATION_COMPLETE.md     # Resumen de implementación
├── ENHANCEMENTS.md                # Changelog de mejoras (v2.0)
├── OPTIMIZACION.md                # Guía de optimización (VAAPI, etc.)
├── DOCKER_SETUP.md                # Configuración Docker
│
├── package.json                   # Frontend: deps + scripts (Yarn 4.11.0)
├── yarn.lock
├── .yarnrc.yml
├── tsconfig.json                  # TypeScript config raíz
├── tsconfig.common.json
├── tsconfig.node.json
├── tsconfig.web.json
├── vite.config.web.ts             # Vite build config (proxy a :8090)
├── .eslintrc.cjs
├── .eslintignore
│
├── src/                           # Código fuente frontend
│   ├── common/
│   │   ├── types.ts               # Tipos compartidos (~300 líneas)
│   │   ├── i18n.ts                # Internacionalización
│   │   └── ffprobe.ts             # Tipos FFprobe
│   └── renderer/
│       ├── index.html             # HTML entry point
│       └── src/
│           ├── App.tsx            # App principal (modo Electron/escritorio)
│           ├── App.web.tsx        # App principal (modo web, 1521 líneas)
│           ├── App.module.css
│           ├── animations.ts
│           ├── colors.ts
│           ├── cmx3600.ts         # Formato EDL CMX3600
│           ├── BottomBar.tsx
│           ├── BetweenSegments.tsx
│           ├── MediaSourcePlayer.tsx
│           ├── NoFileLoaded.tsx
│           ├── TopMenu.tsx
│           ├── LastCommands.tsx
│           ├── components/        # 60+ componentes React
│           ├── hooks/             # 24 custom hooks
│           ├── util/              # Utilidades
│           ├── worker/            # Web Workers
│           └── api/
│               └── client.ts      # Cliente HTTP para API
│
├── backend/                       # Backend Go
│   ├── go.mod                     # Módulo: github.com/mifi/lossless-cut
│   ├── go.sum
│   ├── Makefile
│   ├── .air.toml                  # Hot reload config
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── README.md
│   ├── config/
│   │   └── config.yaml            # Configuración YAML
│   ├── cmd/
│   │   └── server/
│   │       └── main.go            # Entry point del servidor
│   ├── internal/
│   │   ├── api/
│   │   │   ├── router.go          # Definición de rutas
│   │   │   ├── middleware/
│   │   │   │   └── logger.go      # Middleware de logging
│   │   │   └── handlers/
│   │   │       ├── video.go       # ~807 líneas
│   │   │       ├── project.go
│   │   │       ├── system.go
│   │   │       ├── timeline.go    # ~587 líneas
│   │   │       ├── download.go
│   │   │       └── operation.go
│   │   ├── config/
│   │   │   └── config.go          # Carga de config (Viper)
│   │   ├── ffmpeg/
│   │   │   ├── executor.go        # ~1250 líneas, envoltura principal
│   │   │   ├── probe.go           # FFprobe metadata
│   │   │   ├── progress.go        # Parseo de progreso
│   │   │   ├── progress_test.go
│   │   │   ├── face_blur.go       # ~497 líneas, blur vía Python/OpenCV
│   │   │   ├── scene_detection.go # ~262 líneas
│   │   │   └── README.md
│   │   ├── models/
│   │   │   └── models.go          # ~324 líneas, structs de datos
│   │   ├── services/
│   │   │   ├── services.go        # Contenedor de servicios
│   │   │   ├── video_service.go   # ~329 líneas
│   │   │   ├── project_service.go
│   │   │   ├── operation_service.go # ~1305 líneas
│   │   │   ├── download_service.go  # ~649 líneas
│   │   │   └── cleanup_service.go
│   │   └── storage/
│   │       └── manager.go         # ~619 líneas, gestión de archivos
│   ├── scripts/
│   │   ├── blur_faces.py          # Script Python para blur
│   │   └── detect_faces.py        # Script Python para detección
│   ├── web/                       # Build output del frontend
│   │   ├── index.html
│   │   └── assets/
│   └── examples/
│       └── ffmpeg_demo.go
│
├── android/                       # App Android nativa
│   ├── build.gradle.kts
│   ├── settings.gradle.kts
│   ├── gradle.properties
│   ├── gradle/
│   │   └── libs.versions.toml     # Catálogo de versiones
│   └── app/
│       ├── build.gradle.kts
│       ├── proguard-rules.pro
│       └── src/main/
│           ├── AndroidManifest.xml
│           ├── assets/
│           │   ├── native/        # Binarios nativos
│           │   │   ├── ffmpeg     # FFmpeg para ARM64
│           │   │   ├── ffprobe    # FFprobe para ARM64
│           │   │   └── server_arm64 # Servidor Go compilado
│           │   └── web/           # Frontend compilado
│           ├── java/com/losslesscut/app/
│           │   ├── MainActivity.kt
│           │   ├── LosslessCutApp.kt
│           │   ├── server/
│           │   │   ├── ServerManager.kt
│           │   │   ├── ServerService.kt
│           │   │   ├── BinaryExtractor.kt
│           │   │   └── ConfigGenerator.kt
│           │   └── web/
│           │       └── EditorWebView.kt
│           └── res/
│
├── scripts/
│   └── android/
│       ├── build-android.sh
│       ├── build-ffmpeg-android.sh
│       └── setup-android-sdk.sh
│
├── storage/                       # Datos de desarrollo local
│   ├── uploads/
│   ├── outputs/
│   ├── projects/
│   ├── screenshots/
│   ├── waveforms/
│   ├── videos/
│   ├── downloads/
│   └── temp/
│
├── logs/                          # Logs del servidor
├── .github/workflows/             # CI/CD
├── .codewhale/                    # Estado de Codewhale
├── start.sh, stop.sh, restart.sh  # Scripts de control
├── rebuild.sh, server.sh, logs.sh
├── losslesscut-toggle.sh
└── fix_metadata.py
```

---

## 3. Backend (Go)

### 3.1 Entry Point

**Archivo**: `backend/cmd/server/main.go`

```
main()
  ├── flag.Parse() para --config
  ├── zap.NewProduction() → logger
  ├── config.Load(configPath) → cfg
  ├── storage.NewManager(basePath, logger) → store
  │   └── store.Initialize() → crea 8 subdirectorios
  ├── services.NewServices(store, cfg, logger) → svc
  │   ├── NewVideoService(store, cfg, logger)
  │   ├── NewProjectService(store, logger)
  │   ├── NewOperationService(store, cfg, logger)
  │   ├── NewDownloadService(store, videoSvc, cfg, logger)
  │   └── NewCleanupService(store, logger, 1h, 24h)
  ├── api.NewRouter(svc, cfg, logger) → router
  └── http.Server{Addr, Handler: router, ReadTimeout: 5min, WriteTimeout: 10min}
      └── ListenAndServe()
```

### 3.2 Configuración

**Archivo**: `backend/internal/config/config.go`
**Framework**: Viper (spf13/viper)

Estructura `Config` con 4 secciones:

| Sección | Campo | Default | Descripción |
|---------|-------|---------|-------------|
| `server` | `host` | `0.0.0.0` | Dirección de escucha |
| | `port` | `8082` | Puerto |
| | `max_upload_size` | `10GB` | Tamaño máximo de upload |
| | `production` | `false` | Modo producción |
| | `cors_origins` | `["*"]` | Orígenes CORS permitidos |
| `storage` | `base_path` | `/var/losslesscut` | Directorio raíz de datos |
| | `auto_cleanup` | `true` | Limpieza automática |
| | `cleanup_after_days` | `7` | Días antes de limpiar |
| `ffmpeg` | `path` | `ffmpeg` | Ruta al binario |
| | `ffprobe_path` | `ffprobe` | Ruta a ffprobe |
| | `threads` | `0` (auto) | Hilos de CPU |
| `ytdlp` | `path` | `yt-dlp` | Ruta a yt-dlp |
| | `max_quality` | `1080p` | Calidad máxima |

**Carga de config**:
1. Valores por defecto (hardcodeados en `setDefaults()`)
2. Archivo YAML (buscado en: `./config.yaml`, `/etc/losslesscut/config.yaml`, `~/.losslesscut/config.yaml`)
3. Variables de entorno con prefijo `LOSSLESSCUT_` (ej: `LOSSLESSCUT_SERVER_PORT=8080`)

### 3.3 API Router + Endpoints

**Archivo**: `backend/internal/api/router.go`
**Framework**: Gin (gin-gonic/gin)

Middleware aplicado:
- `gin.Recovery()` — recuperación de pánicos
- `middleware.Logger(logger)` — logging estructurado
- CORS configurable (orígenes, métodos, headers)

#### Tabla completa de endpoints

| Método | Ruta | Handler | Descripción |
|--------|------|---------|-------------|
| **System** | | | |
| GET | `/health` | inline | Health check → `{"status":"ok"}` |
| GET | `/api/system/info` | `SystemHandler.Info` | Versiones FFmpeg, yt-dlp, etc. |
| GET | `/api/system/stats` | `SystemHandler.GetStats` | Estadísticas del servidor |
| DELETE | `/api/system/clear-all` | `SystemHandler.ClearAll` | Borrar todo (sesión) |
| POST | `/api/system/session/start` | `SystemHandler.SessionStart` | Iniciar sesión de usuario |
| POST | `/api/system/session/heartbeat` | `SystemHandler.SessionHeartbeat` | Mantener sesión viva |
| POST | `/api/system/session/end` | `SystemHandler.SessionEnd` | Terminar sesión |
| **Videos** | | | |
| GET | `/api/videos` | `VideoHandler.List` | Listar todos los videos |
| POST | `/api/videos/upload` | `VideoHandler.Upload` | Subir archivo (multipart) |
| POST | `/api/videos/batch-upload` | `VideoHandler.BatchUpload` | Subida múltiple |
| POST | `/api/videos/check-compat` | `VideoHandler.CheckCodecCompatibility` | Compatibilidad de codecs |
| POST | `/api/videos/download` | `VideoHandler.Download` | Descargar de URL (TODO) |
| GET | `/api/videos/:id/stream` | `VideoHandler.Stream` | Streaming con Range requests |
| GET | `/api/videos/:id/waveform` | `VideoHandler.Waveform` | Generar/obtener waveform |
| GET | `/api/videos/:id/thumbnail` | `VideoHandler.Thumbnail` | Thumbnail del video |
| POST | `/api/videos/:id/screenshot` | `VideoHandler.Screenshot` | Capturar frame |
| POST | `/api/videos/:id/detect-faces` | `VideoHandler.DetectFaces` | Detección de rostros |
| PUT | `/api/videos/:id` | `VideoHandler.Rename` | Renombrar video |
| DELETE | `/api/videos/:id` | `VideoHandler.Delete` | Eliminar video |
| **Watermarks** | | | |
| POST | `/api/watermarks/upload` | `VideoHandler.WatermarkUpload` | Subir watermark |
| GET | `/api/watermarks/:filename` | `VideoHandler.WatermarkServe` | Servir watermark |
| DELETE | `/api/watermarks/:filename` | `VideoHandler.WatermarkDelete` | Eliminar watermark |
| **Projects** | | | |
| POST | `/api/projects` | `ProjectHandler.Create` | Crear proyecto |
| GET | `/api/projects` | `ProjectHandler.List` | Listar proyectos |
| GET | `/api/projects/:id` | `ProjectHandler.Get` | Obtener proyecto |
| PUT | `/api/projects/:id` | `ProjectHandler.Update` | Actualizar proyecto |
| DELETE | `/api/projects/:id` | `ProjectHandler.Delete` | Eliminar proyecto |
| POST | `/api/projects/:id/export` | `ProjectHandler.Export` | Exportar/cortar video |
| POST | `/api/projects/:id/segments` | `ProjectHandler.AddSegment` | Añadir segmento |
| PUT | `/api/projects/:id/segments/:segId` | `ProjectHandler.UpdateSegment` | Actualizar segmento |
| DELETE | `/api/projects/:id/segments/:segId` | `ProjectHandler.DeleteSegment` | Eliminar segmento |
| **Preview** | | | |
| POST | `/api/preview` | `ProjectHandler.Preview` | Generar preview con efectos |
| **Timeline** | | | |
| POST | `/api/timeline/projects` | `TimelineHandler.CreateProject` | Crear proyecto multi-clip |
| GET | `/api/timeline/projects` | `TimelineHandler.ListProjects` | Listar proyectos timeline |
| GET | `/api/timeline/projects/:id` | `TimelineHandler.GetProject` | Obtener proyecto timeline |
| PUT | `/api/timeline/projects/:id` | `TimelineHandler.UpdateProject` | Actualizar proyecto timeline |
| DELETE | `/api/timeline/projects/:id` | `TimelineHandler.DeleteProject` | Eliminar proyecto timeline |
| POST | `/api/timeline/projects/:id/clips` | `TimelineHandler.AddClip` | Añadir clip a timeline |
| PUT | `/api/timeline/projects/:id/clips/:cid` | `TimelineHandler.UpdateClip` | Actualizar clip |
| DELETE | `/api/timeline/projects/:id/clips/:cid` | `TimelineHandler.DeleteClip` | Eliminar clip |
| POST | `/api/timeline/projects/:id/reorder` | `TimelineHandler.ReorderClips` | Reordenar clips |
| POST | `/api/timeline/projects/:id/sources` | `TimelineHandler.AddVideoSource` | Añadir fuente de video |
| DELETE | `/api/timeline/projects/:id/sources/:vid` | `TimelineHandler.RemoveVideoSource` | Quitar fuente |
| POST | `/api/timeline/projects/:id/export` | `TimelineHandler.Export` | Exportar timeline |
| **Downloads** | | | |
| POST | `/api/downloads` | `DownloadHandler.Start` | Iniciar descarga URL |
| GET | `/api/downloads` | `DownloadHandler.List` | Listar descargas |
| DELETE | `/api/downloads` | `DownloadHandler.ClearAll` | Limpiar todas |
| GET | `/api/downloads/:id` | `DownloadHandler.Get` | Estado de descarga |
| POST | `/api/downloads/:id/cancel` | `DownloadHandler.Cancel` | Cancelar descarga |
| **Operations** | | | |
| GET | `/api/operations/:id` | `OperationHandler.GetStatus` | Progreso de operación |
| **Static** | | | |
| GET | `/api/screenshots/:filename` | inline | Descargar screenshot |
| GET | `/api/outputs/:filename` | inline | Descargar video exportado |
| GET | `/assets/*` | Static | Archivos estáticos del frontend |
| GET | `/` | Static | index.html (SPA) |
| * | `NoRoute` | SPA fallback | index.html para rutas SPA |

> Para una tabla de endpoints más concisa con ejemplos de uso, ver [[LosslessCut Web#Endpoints API]].

### 3.4 Modelos de Datos

**Archivo**: `backend/internal/models/models.go` (~324 líneas)

#### Core Models

```
Project {
    ID, Name, VideoID, SessionID
    Segments []Segment
    MediaFileName string
    CreatedAt, UpdatedAt time.Time
}

Segment {
    ID, Name string
    Start float64
    End *float64         // nil = sin fin definido
    Tags map[string]string
    Color int
    Selected bool
}

Video {
    ID, FileName, OriginalURL, FilePath string
    FileSize int64
    Duration float64
    Width, Height int
    Codec, Format string
    Metadata VideoMetadata
    SessionID string
    CreatedAt time.Time
}

VideoMetadata { Streams []Stream, Format Format, Chapters []Chapter }
Stream { Index, CodecType, CodecName, Width, Height, Duration, BitRate, SampleRate, Channels, Language, Title }
Format { FormatName, FormatLongName, Duration, Size, BitRate }
Chapter { ID, TimeBase, Start, End, StartTime, EndTime, Title }
```

#### Operation Models

```
Operation {
    ID, Type (cut/merge/export/snapshot/preview), ProjectID
    Status (pending/processing/completed/failed)
    Progress float64 (0-100)
    Error string
    OutputFiles []string
    CreatedAt, CompletedAt *time.Time
}
```

#### Export Models

```
ExportRequest {
    Format, OutputName string
    SegmentIDs []string
    MergeSegments, ExportSeparate, ExportChapters bool
    ForceReencode bool
    IntroImagePath string, IntroDuration int
    OutroImagePath string, OutroDuration int
    CropEnabled bool, CropPreset, CropX/Y/Width/Height
    BlurMode ("off"/"auto"/"manual"/"guided")
    BlurRegions []BlurRegion
    DetectionZones []DetectionZone
    BlurConfirmedSignatures [][]float64
    BlurPerClip map[string]bool
    BlurStyle *BlurStyleConfig
    Watermark *WatermarkOptions
}

BlurRegion { ID, X, Y, Width, Height, StartTime, EndTime, BlurIntensity }
DetectionZone { ID, X, Y, Radius, StartTime, EndTime }
BlurStyleConfig { Style ("pixelate"/"gaussian"/"color"/"box"/"emoji"/"image"), Intensity, Color, Emoji, ImageData }
WatermarkOptions { Enabled, Filename, Position, Opacity, Scale, MarginX, MarginY }
```

#### Timeline Models

```
TimelineProject {
    ID, Name, SessionID
    VideoIDs []string              // Múltiples fuentes
    TimelineClips []TimelineClip   // Clips en la línea de tiempo
    TotalDuration float64
    CreatedAt, UpdatedAt time.Time
}

TimelineClip {
    ID, SourceVideoID string
    SourceStart, SourceEnd float64
    TimelinePosition float64
    TrackIndex int
    Name string
    Duration float64
}

TimelineExportRequest {
    ProjectID string
    ClipIDs []string
    OutputName, Format string
    ForceReencode bool
    CropEnabled bool, CropX/Y/Width/Height
    Watermark *WatermarkOptions
}
```

#### Download Models

```
Download {
    ID, URL, Title string
    Duration float64
    Status (pending/downloading/completed/failed/cancelled)
    Progress float64
    FilePath, VideoID, SessionID string
    Error string
    CreatedAt, UpdatedAt time.Time
}

DownloadRequest { URL, Quality string }
```

### 3.5 Servicios

**Archivo**: `backend/internal/services/services.go`

`Services` es un contenedor que agrupa todos los servicios:

```
Services {
    Project   *ProjectService    // CRUD de proyectos, segmentos
    Video     *VideoService      // Upload, metadata, streaming, screenshots, waveforms
    Operation *OperationService  // Export, corte, merge, preview
    Download  *DownloadService   // yt-dlp + descarga directa HTTP
    Cleanup   *CleanupService    // Limpieza periódica de archivos viejos
    Storage   *storage.Manager   // Acceso a archivos
    Logger    *zap.Logger
}
```

#### VideoService
- `CreateFromUpload(filename, path, sessionID)` → extrae metadata con FFprobe, guarda registro
- `GetVideo(id)`, `ListVideos()`, `DeleteVideo(id)`, `RenameVideo(id, name)`
- `StreamVideo(id)` → devuelve ruta para streaming HTTP Range
- `CaptureScreenshot(videoID, timestamp)` → FFmpeg snapshot JPEG
- `GenerateWaveform(videoID)` → FFmpeg showwavespic → PNG (cacheado)
- `GenerateThumbnail(videoID, timestamp)` → thumbnail JPEG
- `DetectFaces(videoID, timestamp)` → llama a script Python
- `CheckCodecCompatibility(videoIDs)` → compatibilidad entre codecs

#### ProjectService
- `Create(name, videoID)`, `CreateWithSession(name, videoID, sessionID)`
- `Get(id)`, `List()`, `Save(project)`, `Delete(id)`
- `AddSegment(projectID, segment)`, `UpdateSegment(...)`, `DeleteSegment(...)`
- Almacenamiento: archivos `.llc` (JSON) en `projects/`

#### OperationService (~1305 líneas, el más complejo)
- `Export(project, request)` → crea Operation, lanza goroutine `runExport()`
  - Soporta: single segment, merge segments, export separate, intro/outro, crop, blur, watermark
  - Flujo: obtiene video → determina segmentos → construye output path → aplica efectos → ejecuta FFmpeg
  - Si `merge_segments`: corta cada segmento → concatena con FFmpeg concat demuxer
  - Si `export_separate`: genera un archivo por segmento
  - Si `blur_mode=auto/manual/guided`: delega a Python/OpenCV via `ffmpeg.BlurFacesAuto()`
- `Preview(request)` → genera preview corto con efectos
- `GetOperation(id)` → consulta estado en memoria (map[string]*Operation con RWMutex)

#### DownloadService (~649 líneas)
- `StartDownload(ctx, req)` → crea Download, lanza goroutine
- Dos modos:
  - **Direct URL**: si la URL termina en `.mp4`, `.mov`, etc. → HTTP GET directo con progress tracking
  - **yt-dlp**: YouTube y otros sitios → ejecuta comando `yt-dlp`
- `GetDownload(id)`, `ListDownloads()`, `CancelDownload(id)`
- Nombrado secuencial: `video1.mp4`, `video2.mp4`, etc. (contador en `video_counter.txt`)

#### CleanupService
- Corre cada 1 hora en background
- Elimina archivos con más de 24 horas de antigüedad
- `Start(ctx)`, `Stop()`, `RunNow()` → delegado a `storage.CleanupOldFiles()`

### 3.6 FFmpeg / FFprobe Wrapper

#### Executor (`executor.go`, ~1250 líneas)

```go
Executor {
    ffmpegPath, ffprobePath string
    logger *zap.Logger
    mu sync.Mutex
    processes map[string]*exec.Cmd    // tracking de procesos activos
}
```

**Métodos principales**:

| Método | Descripción | Comando |
|--------|-------------|---------|
| `Execute(ctx, opts)` | Ejecución genérica con progress | Cualquier args + progress parsing |
| `CutVideo(ctx, in, out, start, end, progress)` | Corte con re-encoding (preciso) | `libx264 -crf 17 -preset ultrafast` |
| `CutVideoLossless(ctx, in, out, start, end, progress)` | Corte sin re-encoding (rápido) | `-c copy` |
| `accurateCut(ctx, in, out, start, dur, progress)` | Corte preciso con CPU | `-ss X -i in -t Y -c:v libx264` |
| `regularCut(ctx, in, out, start, end, progress)` | Corte lossless | `-ss X -to Y -c copy -avoid_negative_ts make_zero` |
| `MergeVideos(ctx, inputs, output)` | Concatenar múltiples videos | Concat demuxer vía archivo temporal |
| `CaptureSnapshot(ctx, in, out, time, quality)` | Screenshot JPEG | `-ss X -i in -vframes 1 -q:v Q out` |
| `GenerateWaveform(ctx, in, out)` | Waveform PNG | `showwavespic` filter |
| `GenerateThumbnail(ctx, in, out, time)` | Thumbnail | `-ss X -i in -vframes 1 -s 320x180 out` |
| `CreateIntroVideo(ctx, img, dur, out, progress)` | Video desde imagen | `-loop 1 -i img -t dur -c:v libx264` |
| `ApplyCrop(ctx, in, out, x, y, w, h)` | Recortar video | `crop` filter |
| `ApplyWatermark(ctx, in, wm, out, opts)` | Superponer watermark | `overlay` filter |
| `BlurFacesAuto(ctx, in, out, intensity, sigs, style, progress)` | Blur de rostros | Delega a script Python |
| `DetectFaces(ctx, in, timestamp)` | Detectar rostros | Delega a script Python |
| `DetectScenes(ctx, in, opts)` | Detección de escenas | `select='gt(scene,T)'` |
| `DetectBlackScenes(ctx, in, minDur)` | Detectar frames negros | `blackdetect` filter |
| `DetectSilentScenes(ctx, in, minDur)` | Detectar silencios | `silencedetect` filter |
| `GetKeyframes(ctx, in)` | Extraer keyframes | `ffprobe -show_frames` |
| `Probe(ctx, path)` | Metadata vía FFprobe | `ffprobe -show_format -show_streams -show_chapters` |

#### ProgressParser (`progress.go`)
- Parsea la salida stderr de FFmpeg con regex
- Extrae `time=HH:MM:SS.MS` de líneas como:
  ```
  frame=  123 fps= 45 q=28.0 size=  1024kB time=00:01:23.45 bitrate=...
  ```
- Calcula `progress = currentTime / totalDuration`
- Soporta formato de audio-only: `size=  ... time=...`
- Maneja tiempos negativos y overflow

#### Face Blur (`face_blur.go`, ~497 líneas)
- Delega a script Python (`scripts/blur_faces.py`) que usa OpenCV
- Soporta 6 estilos de blur: `pixelate`, `gaussian`, `color`, `box`, `emoji`, `image`
- Firma de rostros: tracking de identidad para blur selectivo
  - `nil` → blur a todos los rostros
  - `[]` vacío → no blur a nada
  - `[sig1, sig2...]` → blur solo a rostros que coinciden con firmas
- Las firmas se pasan vía archivo temporal JSON para evitar "argument list too long"
- Progreso vía stdout JSON línea por línea

#### Scene Detection (`scene_detection.go`, ~262 líneas)
- `DetectScenes()`: cambios de escena visual (`select` filter)
- `DetectBlackScenes()`: frames negros (`blackdetect` filter)
- `DetectSilentScenes()`: segmentos de silencio (`silencedetect` filter)
- `GetKeyframes()`: posiciones de keyframes vía ffprobe
- Cada función retorna `[]Scene{Start, End, Duration, Type, Confidence}`

### 3.7 Almacenamiento

**Archivo**: `backend/internal/storage/manager.go` (~619 líneas)

**Sin base de datos** — almacenamiento 100% basado en archivos.

#### Estructura de directorios

```
{base_path}/
├── uploads/          # Archivos de video subidos
├── outputs/          # Videos exportados
├── projects/         # Archivos .llc (JSON con proyectos)
├── temp/             # Archivos temporales de procesamiento
├── downloads/        # Descargas de yt-dlp / URLs
├── videos/           # Metadatos de videos (JSON)
├── waveforms/        # Caché de waveforms (PNG)
├── screenshots/      # Screenshots capturados (JPG)
└── video_counter.txt # Contador secuencial para nombres
```

#### Operaciones del Manager

| Método | Descripción |
|--------|-------------|
| `Initialize()` | Crea los 8 directorios |
| `SaveVideo(v)`, `GetVideo(id)`, `ListVideos()`, `DeleteVideo(id)` | CRUD de metadatos |
| `GetVideoPath(filename)` | Ruta completa a upload |
| `GetProjectPath(id)` | Ruta a `projects/{id}.llc` |
| `GetOutputPath(filename)` | Ruta a `outputs/{filename}` |
| `GetScreenshotPath(filename)` | Ruta a `screenshots/{filename}` |
| `GetWaveformPath(filename)` | Ruta a `waveforms/{filename}` |
| `GetTempPath(filename)` | Ruta a `temp/{filename}` |
| `GetDownloadPath()` | Ruta a `downloads/` |
| `CreateDownload(d)`, `GetDownload(id)`, `UpdateDownload(d)`, `ListDownloads()` | CRUD descargas |
| `GetNextVideoNumber()` | Lee e incrementa `video_counter.txt` |
| `ResetVideoCounter()` | Reinicia contador a 1 |
| `CleanupOldFiles(maxAge)` | Elimina archivos viejos de temp, screenshots, outputs |
| `DeleteFile(path)`, `FileExists(path)`, `GetFileSize(path)` | Operaciones básicas |
| `DeleteAllFiles()` | Limpia todos los directorios (manteniendo estructura) |

**Formato de metadatos de video**: JSON en `videos/{id}.json`
**Formato de proyectos**: JSON indentado en `projects/{id}.llc`
**Formato de descargas**: JSON en `downloads/{id}.json`

**Session ID**: Se usa el header `X-Session-ID` para aislar datos entre usuarios. El backend filtra por session en queries pero el almacenamiento físico no está particionado por sesión.

### 3.8 Handlers HTTP

| Archivo | Líneas | Responsabilidad |
|---------|--------|-----------------|
| `video.go` | ~807 | Upload, stream, screenshot, waveform, thumbnail, detect-faces, rename, delete, watermark CRUD, batch-upload, codec-compat |
| `project.go` | ~250 | CRUD proyectos, CRUD segmentos, export, preview |
| `timeline.go` | ~587 | CRUD timeline projects, CRUD clips, reorder, sources, export |
| `download.go` | ~200 | Start, list, get, cancel, clearAll downloads |
| `system.go` | ~150 | Info, stats, clear-all, session start/heartbeat/end |
| `operation.go` | ~30 | GetStatus (simple lookup en mapa) |

**Patrón común**: Cada handler recibe `*services.Services` (todos los servicios) y `*zap.Logger`. Extrae `sessionID` de `X-Session-ID` header. Usa `gin.Context` para binding/response.

---

## 4. Frontend (React + TypeScript)

### 4.1 Entry Points

**Web**: `src/renderer/src/App.web.tsx` (1521 líneas)
- Pantalla de inicio (HomeUI): hero, cards de features, atajos, upload, file manager
- Gestión de sesiones (start/heartbeat/end vía API)
- File manager con tabs: "Mis archivos" + "Descargar de URL"
- Upload con drag & drop, batch upload
- Restauración de última sesión (localStorage)
- Navegación: Home UI ↔ VideoEditor ↔ MultiSourceEditor
- Tema oscuro púrpura (`#8B5CF6`, `#A78BFA`, `#C084FC`)

**Electron**: `src/renderer/src/App.tsx` (2748 líneas)
- Versión completa heredada del LosslessCut original (escritorio)
- Usa APIs de Electron (`ipcRenderer`, `screenfull`, diálogos nativos)
- Misma base de componentes + hooks compartidos

### 4.2 Componentes (60+ archivos)

#### Componentes principales

| Componente | Descripción |
|-----------|-------------|
| `VideoEditor.tsx` | Editor principal con reproductor, timeline, controles I/O |
| `MultiSourceEditor.tsx` | Editor multi-fuente con timeline de clips |
| `HomeUI.tsx` | Pantalla de inicio con hero section y feature cards |
| `EnhancedHomeTab.tsx` | Tab mejorado con shortcuts, features, platform icons |
| `DownloadModal.tsx` | Modal de descarga YouTube/URL (reconocimiento de plataforma) |
| `MultiClipTimeline.tsx` | Timeline multi-clip con drag & drop |
| `MobileTimeline.tsx` | Timeline vertical optimizado para móviles (TikTok-style) |
| `BigWaveform.tsx` | Visualización grande de waveform |

#### Componentes de UI reutilizables

`Action`, `AlertDialog`, `AnimatedTr`, `Button`, `Checkbox`, `CloseButton`, `CopyClipboardButton`, `Dialog`, `DropdownMenu`, `ErrorDialog`, `GenericDialog`, `HighlightedText`, `Json5Dialog`, `Kbd`, `KeyboardShortcuts`, `Loading`, `Select`, `Spinner`, `Switch`, `SwalContainer`, `TextInput`, `Truncated`, `ValueTuner`, `ValueTuners`, `Warning`, `Working`

#### Componentes de funcionalidad

`AutoExportToggler`, `BatchFile`, `BatchFilesList`, `BlurRegionSelector`, `CaptureFormatButton`, `ConcatDialog`, `CropSelector`, `ExportButton`, `ExportConfirm`, `ExportModeButton`, `ExportSheet`, `ExpressionDialog`, `FileNameTemplateEditor`, `GpsMap`, `IntroOutroSelector`, `OutputFormatSelect`, `PlaybackStreamSelector`, `SegmentCutpointButton`, `SetCutpointButton`, `Settings`, `SimpleModeButton`, `SourcePanel`, `TagEditor`, `ToggleExportConfirm`, `VolumeControl`, `WatermarkSettings`, `WhatsNew`

### 4.3 Hooks (24 archivos)

| Hook | Archivo | Propósito |
|------|---------|-----------|
| `useFfmpegOperations` | `hooks/useFfmpegOperations.ts` | Ejecutar operaciones FFmpeg (cortar, exportar, merge) |
| `useWaveform` | `hooks/useWaveform.ts` | Cargar y cachear waveform images |
| `useKeyboard` | `hooks/useKeyboard.ts` | Mapeo y manejo de atajos de teclado |
| `useKeyframes` | `hooks/useKeyframes.ts` | Extraer y cachear keyframes |
| `useSegments` | `hooks/useSegments.tsx` | Gestión de segmentos (CRUD, undo/redo) |
| `useSegmentsAutoSave` | `hooks/useSegmentsAutoSave.ts` | Auto-guardado de segmentos |
| `useTimelineScroll` | `hooks/useTimelineScroll.ts` | Scroll y zoom del timeline |
| `useVideo` | `hooks/useVideo.ts` | Control del elemento `<video>` |
| `useThumbnails` | `hooks/useThumbnails.ts` | Generación de thumbnails |
| `useFrameCapture` | `hooks/useFrameCapture.ts` | Captura de frames (video tag o FFmpeg) |
| `useFileFormatState` | `hooks/useFileFormatState.ts` | Detección y manejo de formatos |
| `useUserSettings` | `hooks/useUserSettings.ts` | Lectura/escritura de settings |
| `useUserSettingsRoot` | `hooks/useUserSettingsRoot.ts` | Settings a nivel app |
| `useHtml5ify` | `hooks/useHtml5ify.tsx` | Conversión a formatos web-compatibles |
| `useSubtitles` | `hooks/useSubtitles.ts` | Manejo de subtítulos |
| `useTimecode` | `hooks/useTimecode.tsx` | Conversión de timecodes |
| `useLoading` | `hooks/useLoading.ts` | Estado de carga |
| `useErrorHandling` | `hooks/useErrorHandling.ts` | Manejo de errores |
| `useContextMenu` | `hooks/useContextMenu.ts` | Menú contextual (click derecho) |
| `useDirectoryAccess` | `hooks/useDirectoryAccess.ts` | Acceso a directorios (Electron) |
| `useNativeMenu` | `hooks/useNativeMenu.ts` | Menú nativo (Electron) |
| `useStreamsMeta` | `hooks/useStreamsMeta.tsx` | Metadata de streams |
| `useWhatChanged` | `hooks/useWhatChanged.ts` | Changelog / novedades |
| `normalizeWheel` | `hooks/normalizeWheel.ts` | Normalización de eventos wheel |

### 4.4 Utilidades y Tipos

#### Tipos compartidos (`src/common/types.ts`, ~300 líneas)

Define la interfaz `Config` completa con 90+ campos incluyendo:
- Formatos de captura (jpeg/png/webp)
- Timecode formats
- Modo de corte (keyframe/smart)
- Atajos de teclado (`KeyboardAction` con 100+ acciones)
- Preferencias de export y UI
- Settings de waveform, thumbnails, keyframes

`KeyboardAction`: Union type con 100+ acciones (addSegment, togglePlay, seekForwards, export, detectBlackScenes, etc.)

`Config`: Interfaz principal con todos los settings persistentes.

#### Otros archivos de utilidad

| Archivo | Propósito |
|---------|-----------|
| `util.ts` | Funciones generales (formato tiempo, duración, etc.) |
| `util/streams.ts` | Manejo de streams FFmpeg |
| `util/outputNameTemplate.ts` | Templates para nombres de archivo exportado |
| `util/rate-calculator.ts` | Cálculo de bitrate |
| `cmx3600.ts` | Parseo/generación de formato EDL CMX3600 |
| `colors.ts` | Paletas de colores para segmentos |
| `animations.ts` | Configuraciones de Framer Motion |
| `worker/eval.ts` + `worker/evalWorker.ts` | Web Workers para operaciones pesadas |
| `api/client.ts` | Cliente HTTP axios-like para API |

### 4.5 Build (Vite)

**Archivo**: `vite.config.web.ts`

```
Plugin: @vitejs/plugin-react
Root: src/renderer
Build output: backend/web/
Target: es2020
Dev server:
  - Port: 3001
  - Host: 0.0.0.0
  - Proxy /api → http://localhost:8090
  - Proxy /ws → ws://localhost:8090
Alias: @ → src/renderer/src
Define: process.env.IS_WEB = true
```

**package.json scripts**:
- `dev:web` → `vite --config vite.config.web.ts` (hot reload en :3001)
- `build:web` → `vite build --config vite.config.web.ts` (output a backend/web/)
- `tsc` → type checking
- `test` → `vitest`
- `lint` → ESLint

**Dependencias clave**:
- React 18, react-dom, react-icons, react-i18next
- Framer Motion 9 (animaciones)
- i18next (internacionalización)
- immer (estado inmutable)
- lodash, luxon, smpte-timecode
- sweetalert2 (diálogos modales)
- jszip, file-saver (export)
- csv-parse, csv-stringify, cue-parser, fast-xml-parser
- zod (validación)

---

## 5. App Android

### 5.1 Arquitectura

```
MainActivity (Compose)
  └── ServerScreen (Composable)
       ├── [Espera a que ServerManager.isHealthy()]
       └── EditorWebView (WebView)
            └── http://127.0.0.1:8090
                 └── Servidor Go (ELF arm64)
                      ├── FFmpeg/FFprobe (binarios nativos)
                      └── Frontend React (servido desde filesDir)
```

**Principio**: La app Android envuelve el servidor Go como un binario ELF estático ARM64. El frontend React es idéntico al web; se comunica con el backend via `localhost:8090`.

### 5.2 Ciclo de Vida

1. **LosslessCutApp.onCreate()** → crea notification channel
2. **MainActivity.onCreate()** → lanza `ServerService` como foreground service
3. **ServerService.onStartCommand()** → `startForeground()` + `serverManager.start()`
4. **ServerManager.start()**:
   - `BinaryExtractor.extractNative()` → copia ffmpeg, ffprobe, server_arm64 de assets a filesDir/native/
   - `BinaryExtractor.extractWeb()` → copia web/ de assets a filesDir/backend/web/
   - `ConfigGenerator.write()` → genera config.yaml con rutas absolutas
   - `ProcessBuilder(server_arm64, "-config", config.yaml)` → inicia servidor en :8090
5. **Compose UI** → polling `isHealthy()` cada 500ms → muestra WebView cuando ready
6. **ServerService.onDestroy()** → `serverManager.stop()` → `process.destroy()`

### 5.3 Flavors

Dos product flavors en `build.gradle.kts`:

| Flavor | `ENABLE_YTDLP` | Distribución |
|--------|---------------|--------------|
| `play` | `false` | Google Play Store (sin yt-dlp por políticas) |
| `enhanced` | `true` | Sideload (con yt-dlp completo) |

**Componentes Kotlin**:
- `LosslessCutApp.kt` → Application, crea notification channel
- `MainActivity.kt` → Compose UI, lanza servicio, pantalla de carga → WebView
- `ServerManager.kt` → start/stop/health del servidor Go
- `ServerService.kt` → Foreground service (mantiene vivo el server)
- `BinaryExtractor.kt` → Extrae binarios de assets al filesDir
- `ConfigGenerator.kt` → Genera config.yaml dinámico
- `EditorWebView.kt` → WebView + AndroidBridge (JS↔Native)
- `AndroidBridge` → Expone `platform()` y `getDeviceInfo()` al JS

---

## 6. Docker & Producción

### Dockerfile (`backend/Dockerfile`)

```dockerfile
FROM debian:bookworm-slim
RUN apt-get install ffmpeg python3 python3-pip ca-certificates wget
RUN pip3 install --break-system-packages yt-dlp
RUN useradd losslesscut
COPY backend/lossless-cut-server ./server
COPY backend/web ./web
COPY backend/config/config.yaml /etc/losslesscut/config.yaml
USER losslesscut
CMD ["./server", "--config", "/etc/losslesscut/config.yaml"]
```

### docker-compose.yml

```yaml
services:
  losslesscut:
    build:
      context: ..
      dockerfile: backend/Dockerfile
    ports: ["8080:8080"]
    volumes:
      - losslesscut_data:/var/losslesscut
    restart: unless-stopped
    healthcheck:
      test: wget --spider http://localhost:8080/health
      interval: 30s
```

### Volumen

- `losslesscut_data` → `/var/losslesscut` (uploads, outputs, projects, etc.)
- Persiste datos entre reinicios del contenedor

### Build para producción

```bash
# 1. Build frontend → backend/web/
yarn build:web

# 2. Build Go binary
cd backend && make build

# 3. Ejecutar
./server
# o Docker:
docker-compose -f backend/docker-compose.yml up -d
```

---

## 7. Scripts y Herramientas

### Scripts del proyecto

| Script | Propósito |
|--------|-----------|
| `start.sh` | Inicia Docker (docker-compose up -d) |
| `stop.sh` | Detiene Docker |
| `restart.sh` | Reinicia Docker |
| `rebuild.sh` | Reconstruye frontend y levanta servidor |
| `server.sh` | Inicia servidor Go directamente (sin Docker) |
| `logs.sh` | Tail de logs del servidor |
| `losslesscut-toggle.sh` | Alterna estado del servicio (systemd) |
| `fix_metadata.py` | Corrige metadatos de archivos de video |

### Scripts Android (`scripts/android/`)

| Script | Propósito |
|--------|-----------|
| `build-android.sh` | Build completo de la app Android |
| `build-ffmpeg-android.sh` | Compilación cruzada de FFmpeg para ARM64 |
| `setup-android-sdk.sh` | Configuración del Android SDK |

### Scripts Python del backend (`backend/scripts/`)

| Script | Propósito |
|--------|-----------|
| `blur_faces.py` | Detección y blur de rostros con OpenCV |
| `detect_faces.py` | Detección de rostros (retorna coordenadas) |

---

## 8. Workflows y Flujos Clave

### 8.1 Flujo de Edición (Single Video)

```
1. Usuario sube video → POST /api/videos/upload
   └── Backend: guarda archivo → FFprobe extrae metadata → crea Video record

2. Usuario abre editor → App.web.tsx navega a VideoEditor
   └── GET /api/videos/:id/stream → HTML5 <video> con Range requests

3. Usuario presiona I (inicio) y O (fin) para crear segmentos
   └── Frontend: useKeyboard detecta teclas → useSegments añade segmento
   └── Backend: POST /api/projects/:id/segments (si hay proyecto guardado)

4. Usuario puede ajustar zoom, ver waveform, capturar screenshots
   └── Waveform: GET /api/videos/:id/waveform → PNG cacheado
   └── Screenshot: POST /api/videos/:id/screenshot {timestamp}

5. Usuario exporta → ExportConfirm → POST /api/projects/:id/export
   └── Backend: OperationService.runExport() en background
       ├── Single: CutVideo() → re-encode con libx264 (-crf 17)
       ├── Merge: cut + concat
       ├── Separate: n × CutVideo()
       ├── Intro/Outro: CreateIntroVideo() + concat
       ├── Crop: ApplyCrop()
       ├── Blur: BlurFacesAuto() → delegado a Python/OpenCV
       └── Watermark: ApplyWatermark()
   └── Frontend: polling GET /api/operations/:id → progress bar

6. Usuario descarga → GET /api/outputs/:filename
```

### 8.2 Flujo de Descarga (yt-dlp / URL)

```
1. Usuario ingresa URL en DownloadModal
2. POST /api/downloads {url, format}
3. DownloadService.StartDownload():
   ├── Si es URL directa (.mp4, .mov, etc.):
   │   └── HTTP GET con progress tracking por Content-Length
   └── Si es YouTube/otros:
       └── exec: yt-dlp -f best -o output_path URL
4. Progreso llega al frontend vía polling GET /api/downloads/:id
5. Al completar: el archivo se mueve a uploads/ y se crea Video record
```

### 8.3 Flujo Multi-Clip Timeline

```
1. Usuario sube múltiples videos → batch-upload
2. Crea TimelineProject → POST /api/timeline/projects
   └── VideoIDs: [vid1, vid2, vid3]
3. Añade clips desde diferentes fuentes:
   └── POST /api/timeline/projects/:id/clips
       {source_video_id, source_start, source_end, timeline_position, track_index}
4. Exporta → POST /api/timeline/projects/:id/export
   └── Backend: para cada clip, corta del source → concatena en orden
```

### 8.4 Flujo de Blur de Rostros

```
1. Usuario selecciona modo blur en ExportSheet
2. Opción "auto": POST /api/videos/:id/detect-faces {timestamp}
   └── Backend: exec python3 detect_faces.py --input video --timestamp X
   └── Retorna: [{signature, x, y, w, h}, ...]
3. Usuario confirma/descarta rostros → export con blur_mode="auto"
   └── Backend: exec python3 blur_faces.py --input in --output out --intensity 20 --signatures [...]
   └── Progreso vía stdout JSON línea por línea
```

---

## 9. Rendimiento y Optimización

> Ver [[Known Issues]] para bugs relacionados con rendimiento (audio drift, duración incorrecta en lossless cut).

### Optimizaciones actuales

| Área | Técnica | Archivo |
|------|---------|---------|
| Corte | `-ss` antes de `-i` (input seeking) | executor.go |
| Lossless | `-c copy` (sin re-encoding) | executor.go |
| Web MP4 | `-movflags +faststart` | executor.go |
| Streaming | HTTP Range requests | video.go handler |
| Waveform | Cache en disco (PNG) | video_service.go |
| Frontend | memo, requestAnimationFrame, lazy loading | varios |
| CSS | transform3d, will-change, hardware acceleration | CSS modules |
| Timeline | Virtual scrolling (solo segmentos visibles) | VideoEditor.tsx |

### Optimizaciones planificadas (documentadas en OPTIMIZACION.md)

| Optimización | Impacto estimado | Complejidad |
|-------------|-----------------|-------------|
| VAAPI hardware acceleration | 3-10x más rápido en export | Media |
| Pre-buffering (`preload="auto"`) | Menos pausas en reproducción | Baja |
| Media Source Extensions (MSE) | Seek instantáneo | Alta |
| WebCodecs API | Decodificación GPU en navegador | Alta |
| Filtro `select` en lugar de cortar+concatenar | Export merge más rápido | Media |
| Waveform con VAAPI | 2-5x más rápido | Baja |

### Notas de rendimiento del frontend

- **Refs para keyboard handlers**: `pendingCutStartRef`, `segmentsRef`, `projectRef`, `durationRef` usan refs en lugar de state para evitar stale closures en useEffect.
- **Tiempo actual del video**: Siempre se obtiene de `videoRef.current.currentTime`, no de React state, para updates instantáneos.
- **Frame-by-frame**: `requestAnimationFrame()` con auto-aceleración (1x→10x después de 500ms hold).
- **Debounced events**: Previenen re-renders excesivos durante scroll/zoom.

---

## 10. Glosario de Archivos

### Backend — Archivos por responsabilidad

| Archivo | Líneas | Rol |
|---------|--------|-----|
| `cmd/server/main.go` | 40 | Entry point, inicialización, ListenAndServe |
| `internal/config/config.go` | 100 | Carga de config (Viper + defaults + env) |
| `internal/api/router.go` | 200 | Definición de todas las rutas y middleware |
| `internal/api/middleware/logger.go` | 30 | Middleware de logging HTTP |
| `internal/models/models.go` | 324 | 20+ structs: Project, Segment, Video, Operation, etc. |
| `internal/services/services.go` | 50 | Contenedor de servicios |
| `internal/services/video_service.go` | 329 | Upload, metadata, stream, screenshots, waveforms |
| `internal/services/project_service.go` | 170 | CRUD proyectos + segmentos (JSON en disco) |
| `internal/services/operation_service.go` | 1305 | Export, preview, efectos (el más grande) |
| `internal/services/download_service.go` | 649 | yt-dlp + descarga HTTP directa |
| `internal/services/cleanup_service.go` | 90 | Limpieza programada de archivos viejos |
| `internal/ffmpeg/executor.go` | 1250 | Wrapper principal FFmpeg: cut, merge, snapshot, crop, watermark, blur |
| `internal/ffmpeg/probe.go` | 180 | FFprobe: metadata extraction |
| `internal/ffmpeg/progress.go` | 110 | Parseo de progreso FFmpeg desde stderr |
| `internal/ffmpeg/face_blur.go` | 497 | Blur de rostros vía Python/OpenCV |
| `internal/ffmpeg/scene_detection.go` | 262 | Detección de escenas, negros, silencios, keyframes |
| `internal/storage/manager.go` | 619 | File-based storage, 8 directorios, CRUD |
| `internal/api/handlers/video.go` | 807 | Handlers HTTP para videos, watermarks |
| `internal/api/handlers/project.go` | 250 | Handlers HTTP para proyectos, segmentos, export, preview |
| `internal/api/handlers/timeline.go` | 587 | Handlers HTTP para timeline multi-clip |
| `internal/api/handlers/download.go` | 200 | Handlers HTTP para descargas |
| `internal/api/handlers/system.go` | 150 | Handlers HTTP para sistema, sesiones |
| `internal/api/handlers/operation.go` | 30 | Handler para consultar estado de operación |

### Frontend — Archivos clave

| Archivo | Líneas | Rol |
|---------|--------|-----|
| `App.web.tsx` | 1521 | App web: home UI, file manager, navegación, sesiones |
| `App.tsx` | 2748 | App Electron/escritorio (herencia del original) |
| `components/VideoEditor.tsx` | Grande | Editor principal con reproductor y timeline |
| `components/MultiSourceEditor.tsx` | Grande | Editor multi-fuente |
| `components/DownloadModal.tsx` | Mediano | Modal de descarga YouTube/URL |
| `components/MultiClipTimeline.tsx` | Mediano | Timeline multi-clip |
| `components/MobileTimeline.tsx` | Mediano | Timeline vertical móvil |
| `components/HomeUI.tsx` | Mediano | Pantalla de inicio |
| `components/ExportSheet.tsx` | Mediano | Panel de opciones de exportación |
| `components/BlurRegionSelector.tsx` | Mediano | Selector de regiones para blur |
| `hooks/useFfmpegOperations.ts` | Mediano | Ejecutar operaciones FFmpeg |
| `hooks/useKeyboard.ts` | Grande | Gestión de atajos de teclado |
| `hooks/useSegments.tsx` | Grande | CRUD de segmentos con undo/redo |
| `common/types.ts` | 300 | Tipos compartidos (Config, KeyboardAction, etc.) |

### Android — Archivos clave

| Archivo | Rol |
|---------|-----|
| `MainActivity.kt` | Compose UI: pantalla de carga → WebView |
| `LosslessCutApp.kt` | Application: notification channel |
| `ServerManager.kt` | start/stop/health del servidor Go |
| `ServerService.kt` | Foreground service Android |
| `BinaryExtractor.kt` | Extrae binarios de assets/ |
| `ConfigGenerator.kt` | Genera config.yaml dinámico |
| `EditorWebView.kt` | WebView + AndroidBridge JS↔Native |

---

## Referencias Rápidas

### Puertos por entorno

| Entorno | Puerto | Descripción |
|---------|--------|-------------|
| Desarrollo frontend | 3001 | Vite dev server |
| Desarrollo backend | 8090 | Go server (usado por Vite proxy) |
| Producción | 8080 | Go server (sirve frontend + API) |
| Docker | 8080 | Contenedor expuesto |
| Android | 8090 | localhost interno de la app |

### Comandos frecuentes

```bash
# Desarrollo
yarn dev:web                              # Frontend con hot reload (:3001)
cd backend && make dev                    # Backend con hot reload (:8090)

# Build
yarn build:web                            # Frontend → backend/web/
cd backend && make build                  # Binary Go

# Test
yarn test                                 # Vitest (frontend)
cd backend && make test                   # Go tests

# Docker
./start.sh                                # Iniciar contenedor
docker-compose -f backend/docker-compose.yml logs -f
```

### Dependencias del sistema

- **Go** 1.21+
- **Node.js** 18+
- **FFmpeg** 6.0+ (con ffprobe)
- **yt-dlp** (opcional, para descargas)
- **Python 3** + OpenCV (opcional, para blur de rostros)
- **Yarn** 4.x

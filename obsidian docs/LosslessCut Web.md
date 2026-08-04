# LosslessCut Web

> 📡 Guía operativa y de referencia rápida. Para arquitectura completa, ver [[BRAIN]]. Para issues conocidos, ver [[Known Issues]]. Para la paleta de colores, ver [[Theme — Purple]].

Editor de video/audio sin pérdida vía navegador (FFmpeg + Go + React).

## Stack

- **Frontend**: React 18, TypeScript, Vite 6, Framer Motion 9, react-icons, i18next
- **Backend**: Go 1.21+, Gin, Zap (logging), Viper (config)
- **Procesamiento**: FFmpeg 6.0+ (static con libx264), FFprobe, yt-dlp
- **Testing**: Vitest (frontend), Go testing (backend)

## Puertos

| Entorno | Puerto | Qué corre |
|---------|--------|-----------|
| Dev frontend | `3001` | Vite dev server con hot reload, proxy API → `:8090` |
| Dev backend | `8090` | Go server en modo desarrollo |
| Producción | `8080` | Go server sirviendo frontend + API |
| Docker | `8080` | Contenedor expuesto |
| Android | `8090` | localhost interno de la app |

## Inicio rápido

```bash
# Desarrollo con hot reload
# Terminal 1: Backend
cd backend && make dev          # Puerto 8090 (requiere air)

# Terminal 2: Frontend
yarn dev:web                    # Puerto 3001

# Build producción
yarn build:web                  # Frontend → backend/web/
cd backend && make build        # Binario Go
./lossless-cut-server           # Puerto 8080

# Docker
docker-compose -f backend/docker-compose.yml up -d
```

## Configuración

`backend/config/config.yaml`:

```yaml
server:
  host: 0.0.0.0
  port: 8080
  max_upload_size: 10737418240  # 10 GB
  production: false
  cors_origins: ["*"]

storage:
  base_path: /var/losslesscut    # En desarrollo: ./storage/
  auto_cleanup: true
  cleanup_after_days: 7

ffmpeg:
  path: ffmpeg                  # O ruta a binario estático
  ffprobe_path: ffprobe
  threads: 0                    # Auto

ytdlp:
  path: yt-dlp
  max_quality: 1080p
```

Variables de entorno: prefijo `LOSSLESSCUT_` (ej: `LOSSLESSCUT_SERVER_PORT=8080`).

## Directorios de almacenamiento

```
{base_path}/
├── uploads/       # Videos subidos
├── videos/        # Metadatos JSON de videos
├── projects/      # Proyectos .llc (JSON)
├── outputs/       # Exportaciones
├── downloads/     # Descargas yt-dlp / URLs
├── temp/          # Archivos temporales
├── waveforms/     # Caché de waveforms (PNG)
└── screenshots/   # Screenshots y thumbnails (JPG)
```

## FFmpeg (static binary)

En distribuciones como Fedora, el FFmpeg del sistema no incluye libx264 por patentes. Solución: usar un build estático de [johnvansickle.com](https://johnvansickle.com/ffmpeg/). Se configura en `ffmpeg.path` del `config.yaml`. Ver [[Known Issues#FFmpeg sin libx264 en Fedora (RESUELTO)]].

## Endpoints API

### Videos
- `GET /api/videos` — Listar (filtrados por `X-Session-ID`)
- `POST /api/videos/upload` — Subir archivo (multipart)
- `POST /api/videos/batch-upload` — Subida múltiple
- `POST /api/videos/check-compat` — Compatibilidad de codecs entre archivos
- `POST /api/videos/download` — Descargar de URL (TODO)
- `GET /api/videos/:id/stream` — Streaming con HTTP Range requests
- `GET /api/videos/:id/waveform` — Waveform (PNG cacheado)
- `GET /api/videos/:id/thumbnail` — Thumbnail del video
- `POST /api/videos/:id/screenshot` — Capturar screenshot en timestamp
- `POST /api/videos/:id/detect-faces` — Detectar rostros (Python/OpenCV)
- `PUT /api/videos/:id` — Renombrar (`{ file_name: "..." }`)
- `DELETE /api/videos/:id` — Eliminar video y archivo

### Watermarks
- `POST /api/watermarks/upload` — Subir watermark
- `GET /api/watermarks/:filename` — Servir watermark
- `DELETE /api/watermarks/:filename` — Eliminar watermark

### Proyectos
- `POST /api/projects` — Crear proyecto
- `GET /api/projects` — Listar proyectos
- `GET /api/projects/:id` — Obtener proyecto
- `PUT /api/projects/:id` — Actualizar proyecto
- `DELETE /api/projects/:id` — Eliminar proyecto
- `POST /api/projects/:id/export` — Exportar/cortar segmentos
- `POST /api/projects/:id/segments` — Agregar segmento
- `PUT /api/projects/:id/segments/:segId` — Actualizar segmento
- `DELETE /api/projects/:id/segments/:segId` — Eliminar segmento

### Timeline (Multi-clip)
- `POST /api/timeline/projects` — Crear proyecto multi-fuente
- `GET /api/timeline/projects` / `GET .../:id` / `PUT .../:id` / `DELETE .../:id`
- `POST /api/timeline/projects/:id/clips` — Agregar clip
- `PUT /api/timeline/projects/:id/clips/:clipId` — Actualizar clip
- `DELETE /api/timeline/projects/:id/clips/:clipId` — Eliminar clip
- `POST /api/timeline/projects/:id/reorder` — Reordenar clips
- `POST /api/timeline/projects/:id/sources` — Agregar fuente de video
- `DELETE /api/timeline/projects/:id/sources/:videoId` — Quitar fuente
- `POST /api/timeline/projects/:id/export` — Exportar timeline

### Preview
- `POST /api/preview` — Generar preview con efectos (crop, blur)

### Descargas (yt-dlp + URL directa)
- `POST /api/downloads` — Iniciar descarga
- `GET /api/downloads` — Listar descargas
- `GET /api/downloads/:id` — Estado de descarga
- `POST /api/downloads/:id/cancel` — Cancelar descarga
- `DELETE /api/downloads` — Limpiar todas

### Operaciones
- `GET /api/operations/:id` — Progreso de exportación/procesamiento

### Sistema
- `GET /health` — Health check
- `GET /api/system/info` — Versiones FFmpeg, yt-dlp, etc.
- `GET /api/system/stats` — Estadísticas del servidor
- `DELETE /api/system/clear-all` — Borrar datos de sesión
- `POST /api/system/session/start` — Iniciar sesión
- `POST /api/system/session/heartbeat` — Heartbeat (cada 30s)
- `POST /api/system/session/end` — Terminar sesión

### Descarga de archivos
- `GET /api/outputs/:filename` — Descargar video exportado
- `GET /api/screenshots/:filename` — Descargar screenshot

## Headers

Todas las requests deben incluir:
```
X-Session-ID: sess_<random>_<timestamp>
```

El frontend genera un `sessionId` al cargar (`App.web.tsx`, `sessionIdRef`) y lo envía en cada request. El backend lo usa para aislar datos entre usuarios.

## Almacenamiento de sesión (localStorage)

- `losslesscut_last_video`: último video abierto — se restaura al recargar
- `losslesscut_last_project`: último proyecto abierto

## Exportación de segmentos

- **Sin efectos** (sin crop, blur, watermark): Re-encode con `libx264 ultrafast CRF 17` — frame-accurate
- **Merge**: Corta cada segmento → concatena con FFmpeg concat demuxer
- **Separate**: Un archivo por segmento
- **Con blur**: Corta a temp → Python/OpenCV → concatena
- **Con crop, watermark, intro/outro**: Filtros FFmpeg aplicados en el pipeline

El re-encode es necesario para precisión de fotogramas — ver [[Known Issues#Exportación duración incorrecta (RESUELTO)]]. Si solo se requiere velocidad y la alineación con keyframes es aceptable, usar `CutVideoLossless` (`-c copy`) en `operation_service.go`. Para el pipeline completo, ver [[BRAIN#8.1 Flujo de Edición (Single Video)]].

## Keyboard Shortcuts (VideoEditor)

| Tecla | Acción |
|-------|--------|
| `Space` | Play/Pause |
| `I` | Marcar inicio del segmento (In) |
| `O` | Marcar fin y crear segmento (Out) |
| `←` / `→` | Retroceder/avanzar 1s |
| `Shift+←` / `Shift+→` | Retroceder/avanzar 0.1s |
| `Ctrl+Wheel` | Zoom del timeline |
| `Hold ←/→` | Frame-by-frame playback con auto-aceleración (1x→10x) |

> Para el mapeo completo de 100+ atajos disponibles en el frontend, ver [[BRAIN#4.2 Componentes]].

## Flujo de trabajo típico

1. Subir video → `POST /api/videos/upload`
2. Abrir editor → `GET /api/videos/:id/stream`
3. Marcar segmentos con `I` y `O`
4. Opcional: ajustar crop, blur, watermark, intro/outro
5. Exportar → `POST /api/projects/:id/export`
6. Monitorear progreso → `GET /api/operations/:id`
7. Descargar resultado → `GET /api/outputs/:filename`

## Thumbnails

La lista de archivos muestra thumbnails reales generados con FFmpeg (`-ss 0 -vframes 1`). Cache: `max-age=86400`. Fallback a ícono SVG si falla.

## Renombrar archivos

Botón de lápiz en cada archivo → input inline → `PUT /api/videos/:id` con `{ file_name }` → actualiza JSON de metadatos y refresca UI.

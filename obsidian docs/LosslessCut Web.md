# LosslessCut Web

Editor de video/audio sin pérdida vía navegador (FFmpeg + Go + React).

## Stack

- **Frontend**: React 18, TypeScript, Vite, Framer Motion, react-icons
- **Backend**: Go, Gin, Zap (logging), Viper (config)
- **Procesamiento**: FFmpeg (static binary), FFprobe, yt-dlp
- **Proxy**: Python (fix_metadata.py — guarda metadatos JSON en uploads/downloads)

## Servicios

| Servicio | Puerto | Descripción |
|----------|--------|-------------|
| Go backend | `:8082` | API + sirve frontend estático |
| Python proxy | `:8080` | Proxy transparente → :8082, guarda metadatos |

## Inicio rápido

```bash
# Build frontend
cd /home/jhon/lossless && yarn build:web

# Build Go binary
cd /home/jhon/lossless/backend && /tmp/go/bin/go build -o lossless-cut-server ./cmd/server/

# Iniciar backend (puerto 8082)
cd /home/jhon/lossless/backend && setsid ./lossless-cut-server -config ./config/config.yaml &>/tmp/server.log &

# Iniciar proxy (puerto 8080)
cd /home/jhon/lossless && setsid python3 fix_metadata.py &>/tmp/proxy.log &
```

Acceder en: `http://<IP>:8080`

## Configuración

`backend/config/config.yaml`:

- `storage.base_path`: directorio de almacenamiento (`/home/jhon/lossless/storage`)
- `ffmpeg.path`: ruta al binario FFmpeg estático (`/home/jhon/lossless/backend/ffmpeg-static`)
- `ffmpeg.ffprobe_path`: ruta a FFprobe estático
- `server.port`: puerto del backend Go (8082)
- `storage.auto_cleanup: false` — no borra archivos viejos automáticamente

## Directorios de almacenamiento

```
storage/
├── uploads/       # Videos subidos
├── downloads/     # Videos descargados (yt-dlp)
├── videos/        # Metadatos JSON de videos
├── projects/      # Proyectos guardados
├── outputs/       # Exportaciones
├── temp/          # Archivos temporales
├── waveforms/     # Waveforms generados
└── screenshots/   # Screenshots/thumbnails
```

## FFmpeg (static binary)

Fedora no incluye libx264 en su FFmpeg por políticas de patentes. Se usa un build estático de johnvansickle.com.

- **Binario**: `/home/jhon/lossless/backend/ffmpeg-static`
- **FFprobe**: `/home/jhon/lossless/backend/ffprobe-static`
- Soporta libx264, libx265, AAC, etc.

## Endpoints API

### Videos
- `GET /api/videos` — Listar (filtrados por X-Session-ID)
- `POST /api/videos/upload` — Subir archivo
- `GET /api/videos/:id/stream` — Stream con range requests
- `GET /api/videos/:id/thumbnail` — Thumbnail (screenshot en t=0)
- `POST /api/videos/:id/screenshot` — Capturar screenshot
- `PUT /api/videos/:id` — Renombrar (`{ file_name: "..." }`)
- `DELETE /api/videos/:id` — Eliminar

### Proyectos
- `POST /api/projects` / `GET /api/projects` / `PUT /api/projects/:id` / `DELETE /api/projects/:id`
- `POST /api/projects/:id/export` — Exportar segmentos
- `POST /api/projects/:id/segments` — Agregar segmento

### Descargas (yt-dlp)
- `POST /api/download` — Descargar de URL
- `GET /api/download/:id/status` — Estado de descarga

### Operaciones
- `GET /api/operations/:id` — Estado de exportación/procesamiento

### Sistema
- `GET /health` — Health check
- `POST /api/system/session/start` — Iniciar sesión
- `POST /api/system/session/heartbeat` — Heartbeat de sesión

## Headers

Todas las requests deben incluir:
```
X-Session-ID: sess_<random>_<timestamp>
```

El frontend genera un sessionId al cargar y lo persiste en `sessionIdRef`.

## Almacenamiento de sesión

- `localStorage['losslesscut_last_video']`: último video abierto
- `localStorage['losslesscut_last_project']`: último proyecto abierto
- Al recargar la página, se restaura automáticamente el último video/proyecto

## Exportación de segmentos

- **Sin filtros** (sin crop, sin blur): Re-encode con `libx264 ultrafast CRF 17` (frame-accurate)
- **Con filtros**: Re-encode con filtros aplicados
- **Con blur automático**: Corta a temp, aplica blur, concatena

El re-encode es necesario para precisión de fotogramas. Si solo se requiere velocidad y la alineación con keyframes es aceptable, cambiar `CutVideo` → `CutVideoLossless` en `operation_service.go:1179`.

## Keyboard shortcuts (VideoEditor)

| Tecla | Acción |
|-------|--------|
| Space | Play/Pause |
| I | Marcar inicio del fragmento |
| O | Marcar fin y crear fragmento |
| ← / → | Retroceder/avanzar 1s |
| Shift+← / Shift+→ | Retroceder/avanzar 0.1s |

## Atajos de segmentos

- Al crear un nuevo fragmento con I→O, se deseleccionan automáticamente los anteriores
- Solo se exportan los fragmentos seleccionados (checkbox en la sidebar)

## Thumbnails

La lista de archivos muestra thumbnails reales del video generados con FFmpeg screenshot en t=0. Fallback a ícono SVG si falla la generación.

## Renombrar archivos

Botón de lápiz en cada archivo de la lista → input inline → `PUT /api/videos/:id` con `{ file_name }` → se actualiza el JSON de metadatos.

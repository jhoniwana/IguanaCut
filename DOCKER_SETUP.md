# LosslessCut Web - Configuración Docker

## Requisitos

- Docker
- Docker Compose

## Inicio Rápido

```bash
./start.sh
```

Accede a: **http://localhost:8080**

## Comandos

```bash
# Iniciar
docker-compose -f backend/docker-compose.yml up -d

# Detener
docker-compose -f backend/docker-compose.yml down

# Ver logs
docker-compose -f backend/docker-compose.yml logs -f

# Reconstruir (después de cambios)
docker-compose -f backend/docker-compose.yml up --build -d

# Ver estado
docker ps
```

## Auto-inicio

El contenedor se inicia automáticamente al encender el computador gracias a:
- Docker habilitado en systemd: `systemctl enable docker`
- Política de reinicio: `restart: unless-stopped`

## Problemas Resueltos Durante la Configuración

### 1. Contexto de Docker incorrecto
**Problema:** El Dockerfile buscaba archivos desde la raíz pero docker-compose estaba en `backend/`

**Solución:** Modificar `docker-compose.yml`:
```yaml
build:
  context: ..
  dockerfile: backend/Dockerfile
```

### 2. Archivos inexistentes en Dockerfile
**Problema:** El Dockerfile original buscaba `index.html`, `public/`, `vite.config.ts`, `electron.vite.config.ts` que no existen

**Solución:** Simplificar Dockerfile para usar el binario y frontend pre-compilados

### 3. Binario incompatible con Alpine
**Problema:** El binario `lossless-cut-server` fue compilado con glibc pero Alpine usa musl
```
exec ./server: no such file or directory
```

**Solución:** Cambiar imagen base de `alpine` a `debian:bookworm-slim`

### 4. pip3 bloqueado en Alpine
**Problema:** Alpine bloquea instalación de paquetes con pip
```
error: externally-managed-environment
```

**Solución:** Usar `--break-system-packages`:
```dockerfile
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp
```

### 5. Permisos de volumen
**Problema:** El directorio `./data` pertenecía a root causando errores de permisos
```
permission denied: mkdir /var/losslesscut/uploads
```

**Solución:** Usar volumen nombrado en lugar de bind mount:
```yaml
volumes:
  - losslesscut_data:/var/losslesscut

volumes:
  losslesscut_data:
```

### 6. Puerto incorrecto en config.yaml
**Problema:** `config.yaml` tenía `port: 8082` pero Dockerfile exponía 8080

**Solución:** Cambiar `backend/config/config.yaml`:
```yaml
server:
  port: 8080
```

## Estructura de Archivos Clave

```
losslesscut-web/
├── start.sh                    # Script de inicio
├── backend/
│   ├── docker-compose.yml      # Configuración Docker
│   ├── Dockerfile              # Imagen Docker
│   ├── config/
│   │   └── config.yaml         # Configuración del servidor
│   ├── lossless-cut-server     # Binario pre-compilado
│   └── web/                    # Frontend pre-compilado
```

## Configuración Final

### docker-compose.yml
```yaml
services:
  losslesscut:
    build:
      context: ..
      dockerfile: backend/Dockerfile
    ports:
      - "8080:8080"
    volumes:
      - losslesscut_data:/var/losslesscut
    environment:
      - LOSSLESSCUT_SERVER_PORT=8080
      - LOSSLESSCUT_STORAGE_BASE_PATH=/var/losslesscut
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  losslesscut_data:
```

### Dockerfile
```dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

RUN groupadd -g 1000 losslesscut && \
    useradd -u 1000 -g losslesscut -m losslesscut

RUN mkdir -p /var/losslesscut/uploads /var/losslesscut/outputs /var/losslesscut/projects /app/web && \
    chown -R losslesscut:losslesscut /var/losslesscut /app

WORKDIR /app

COPY backend/lossless-cut-server ./server
COPY backend/web ./web
COPY backend/config/config.yaml /etc/losslesscut/config.yaml

RUN chmod +x ./server && chown losslesscut:losslesscut ./server

USER losslesscut
EXPOSE 8080

CMD ["./server", "--config", "/etc/losslesscut/config.yaml"]
```

### config.yaml
```yaml
server:
  host: 0.0.0.0
  port: 8080
  max_upload_size: 10737418240  # 10GB
  production: false
  cors_origins:
    - "*"

storage:
  base_path: /var/losslesscut
  auto_cleanup: true
  cleanup_after_days: 7

ffmpeg:
  path: ffmpeg
  threads: 0

ytdlp:
  path: yt-dlp
  max_quality: 1080p
```

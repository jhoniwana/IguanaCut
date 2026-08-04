#!/bin/bash

# LosslessCut Web Server Manager
# Gestiona el servidor (puerto configurado en backend/config/config.yaml)
# Uso: ./server.sh [start|stop|restart|status|logs|build]

set -e

# Configuracion (rutas derivadas del script -> funciona en cualquier maquina)
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR"
LOG_DIR="$APP_DIR/logs"
PID_FILE="$APP_DIR/server.pid"
LOG_FILE="$LOG_DIR/backend.log"
CONFIG="$BACKEND_DIR/config/config.yaml"
BINARY="$BACKEND_DIR/server"
PORT=$(grep -E '^\s+port:' "$CONFIG" 2>/dev/null | awk '{print $2}' | head -1)
PORT="${PORT:-8090}"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Detener servidor
stop_server() {
    log "Deteniendo servidor..."

    # Matar por PID file
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
        if [ ! -z "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
            kill "$PID" 2>/dev/null || true
            log "Servidor detenido (PID: $PID)"
        fi
        rm -f "$PID_FILE"
    fi

    # Matar procesos restantes
    pkill -f "./server" 2>/dev/null || true
    pkill -f "./lossless-cut-server" 2>/dev/null || true
    pkill -f "lossless-cut-server" 2>/dev/null || true

    # Liberar puerto
    fuser -k ${PORT}/tcp 2>/dev/null || true

    sleep 2
    log "Servidor detenido"
}

# Construir proyecto
build_project() {
    log "Construyendo frontend..."
    cd "$FRONTEND_DIR"
    yarn build:web > "$LOG_DIR/frontend-build.log" 2>&1
    log "Frontend construido"

    log "Construyendo backend..."
    cd "$BACKEND_DIR"
    make build > "$LOG_DIR/backend-build.log" 2>&1
    log "Backend construido"
}

# Iniciar servidor
start_server() {
    # Verificar si ya esta corriendo
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
        if [ ! -z "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
            warn "El servidor ya esta corriendo (PID: $PID)"
            return 0
        fi
    fi

    # Crear directorio de logs
    mkdir -p "$LOG_DIR"

    log "Iniciando servidor en puerto $PORT..."
    cd "$BACKEND_DIR"

    # Construir si el binario no existe
    if [ ! -x "$BINARY" ]; then
        make build > "$LOG_DIR/backend-build.log" 2>&1
    fi

    # Iniciar en segundo plano
    nohup "$BINARY" -config "$CONFIG" > "$LOG_FILE" 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"

    # Esperar a que inicie
    sleep 3

    # Verificar
    if ps -p $PID > /dev/null 2>&1; then
        log "Servidor iniciado (PID: $PID)"
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  LosslessCut Web - Puerto $PORT${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""
        echo -e "  URL Local:  ${BLUE}http://localhost:$PORT${NC}"
        echo -e "  URL Red:    ${BLUE}http://$(hostname -I | awk '{print $1}'):$PORT${NC}"
        echo ""
        echo -e "  Logs:       ${YELLOW}./server.sh logs${NC}"
        echo -e "  Detener:    ${YELLOW}./server.sh stop${NC}"
        echo -e "  Reiniciar:  ${YELLOW}./server.sh restart${NC}"
        echo ""
        echo -e "${GREEN}========================================${NC}"
    else
        error "Error al iniciar el servidor"
        cat "$LOG_FILE"
        exit 1
    fi
}

# Estado del servidor
show_status() {
    echo ""
    echo -e "${BLUE}=== Estado del Servidor ===${NC}"
    echo ""

    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
        if [ ! -z "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
            echo -e "Estado:  ${GREEN}CORRIENDO${NC}"
            echo -e "PID:     $PID"
            echo -e "Puerto:  $PORT"

            # Verificar health
            if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
                echo -e "Health:  ${GREEN}OK${NC}"
            else
                echo -e "Health:  ${YELLOW}NO RESPONDE${NC}"
            fi
        else
            echo -e "Estado:  ${RED}DETENIDO${NC}"
            rm -f "$PID_FILE"
        fi
    else
        echo -e "Estado:  ${RED}DETENIDO${NC}"
    fi

    echo ""
}

# Mostrar logs
show_logs() {
    if [ -f "$LOG_FILE" ]; then
        echo -e "${BLUE}=== Logs del Servidor ===${NC}"
        echo "(Presiona Ctrl+C para salir)"
        echo ""
        tail -f "$LOG_FILE"
    else
        warn "No hay logs disponibles"
    fi
}

# Menu principal
case "$1" in
    start)
        start_server
        ;;
    stop)
        stop_server
        ;;
    restart)
        stop_server
        sleep 2
        start_server
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    build)
        build_project
        ;;
    rebuild)
        stop_server
        build_project
        start_server
        ;;
    *)
        echo ""
        echo "LosslessCut Web Server Manager"
        echo ""
        echo "Uso: $0 {start|stop|restart|status|logs|build|rebuild}"
        echo ""
        echo "Comandos:"
        echo "  start    - Iniciar servidor en segundo plano"
        echo "  stop     - Detener servidor"
        echo "  restart  - Reiniciar servidor"
        echo "  status   - Ver estado del servidor"
        echo "  logs     - Ver logs en tiempo real"
        echo "  build    - Construir frontend y backend"
        echo "  rebuild  - Reconstruir y reiniciar servidor"
        echo ""
        exit 1
        ;;
esac

exit 0

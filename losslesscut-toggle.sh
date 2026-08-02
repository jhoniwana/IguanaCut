#!/bin/bash
# LosslessCut Web Edition - iniciar/detener servidor
# Uso: losslesscut-toggle.sh [start|stop|toggle]

set -e

APP_DIR="/home/jhon/losslesscut"
BINARY="$APP_DIR/backend/server"
CONFIG="$APP_DIR/backend/config/config.yaml"
LOG_DIR="$APP_DIR/logs"
PID_FILE="$APP_DIR/server.pid"
URL="http://localhost:8090"

mkdir -p "$LOG_DIR"

is_running() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        return 0
    fi
    if pgrep -f "server -config config/config.yaml" >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

get_pid() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        cat "$PID_FILE"
    else
        pgrep -f "server -config config/config.yaml" | head -1
    fi
}

start() {
    if is_running; then
        notify-send -a LosslessCut "LosslessCut ya está corriendo" "$URL"
        xdg-open "$URL" 2>/dev/null || true
        exit 0
    fi
    cd "$APP_DIR/backend"
    nohup "$BINARY" -config "$CONFIG" >> "$LOG_DIR/backend.log" 2>&1 &
    echo $! > "$PID_FILE"
    for i in $(seq 1 20); do
        if curl -sf "$URL/health" >/dev/null 2>&1; then
            notify-send -a LosslessCut "LosslessCut iniciado" "Abriendo $URL"
            xdg-open "$URL" 2>/dev/null || true
            exit 0
        fi
        sleep 0.5
    done
    notify-send -a LosslessCut "Error iniciando LosslessCut" "Revisa $LOG_DIR/backend.log"
    exit 1
}

stop() {
    if ! is_running; then
        notify-send -a LosslessCut "LosslessCut no está corriendo"
        exit 0
    fi
    PID=$(get_pid)
    kill "$PID" 2>/dev/null || true
    for i in $(seq 1 20); do
        if ! kill -0 "$PID" 2>/dev/null; then
            rm -f "$PID_FILE"
            notify-send -a LosslessCut "LosslessCut detenido"
            exit 0
        fi
        sleep 0.5
    done
    kill -9 "$PID" 2>/dev/null || true
    rm -f "$PID_FILE"
    notify-send -a LosslessCut "LosslessCut detenido"
}

toggle() {
    if is_running; then
        stop
    else
        start
    fi
}

case "${1:-toggle}" in
    start) start ;;
    stop) stop ;;
    toggle) toggle ;;
    *) echo "Uso: $0 [start|stop|toggle]"; exit 1 ;;
esac

#!/bin/bash
# Construye la app Android "todo en uno" completa:
#   1. Frontend React -> backend/web/
#   2. Backend Go -> ELF estatico ARM64
#   3. FFmpeg/ffprobe para Android
#   4. Copia assets al proyecto Android
#   5. Gradle -> APK/AAB
#
# Uso: scripts/android/build-android.sh [play|enhanced] [release|debug]
#
# Requiere:
#   - Node + yarn (frontend)
#   - Go (backend)
#   - Android SDK + NDK (ver setup-android-sdk.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ANDROID_DIR="$REPO_DIR/android"
ASSETS_NATIVE="$ANDROID_DIR/app/src/main/assets/native"
ASSETS_WEB="$ANDROID_DIR/app/src/main/assets/web"

FLAVOR="${1:-play}"
BUILD_TYPE="${2:-release}"

# El flavor "play" (Google Play) no incluye yt-dlp -> ocultar la descarga desde URL
if [ "$FLAVOR" = "play" ]; then
    VITE_HIDE_URL_DOWNLOAD=1
else
    VITE_HIDE_URL_DOWNLOAD=0
fi

if command -v yarn >/dev/null 2>&1; then
    YARN_BIN="yarn"
else
    YARN_BIN="node"
    YARN_ARGS=("$REPO_DIR/.yarn/releases/yarn-4.11.0.cjs")
fi

# Gradle 8.x / AGP no soportan Java 26+; buscar un JDK 17-21 si hace falta
if command -v java >/dev/null 2>&1; then
    JAVA_MAJOR=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p')
else
    JAVA_MAJOR=0
fi
if [ "${JAVA_MAJOR:-0}" -gt 21 ]; then
    for CAND in "$HOME/.jdks"/* /usr/lib/jvm/*; do
        [ -x "$CAND/bin/java" ] || continue
        V=$("$CAND/bin/java" -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p')
        if [ "$V" -ge 17 ] && [ "$V" -le 21 ]; then
            export JAVA_HOME="$CAND"
            echo "-> Gradle no soporta Java $JAVA_MAJOR; usando JAVA_HOME=$JAVA_HOME (Java $V)"
            break
        fi
    done
fi

echo "==================== 1/5 Frontend ===================="
cd "$REPO_DIR"
VITE_HIDE_URL_DOWNLOAD="$VITE_HIDE_URL_DOWNLOAD" "$YARN_BIN" "${YARN_ARGS[@]}" build:web
echo "-> backend/web/ OK"

echo "==================== 2/5 Backend Go (ARM64) ===================="
cd "$REPO_DIR/backend"
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath \
    -ldflags="-s -w" -o /tmp/losslesscut-server-arm64 ./cmd/server
mkdir -p "$ASSETS_NATIVE"
cp /tmp/losslesscut-server-arm64 "$ASSETS_NATIVE/server_arm64"
echo "-> server_arm64 OK ($(du -h /tmp/losslesscut-server-arm64 | cut -f1))"

echo "==================== 3/5 FFmpeg (arm64) ===================="
"$SCRIPT_DIR/build-ffmpeg-android.sh"
FF_DIST="$SCRIPT_DIR/ffmpeg-dist/arm64-v8a/bin"
cp "$FF_DIST/ffmpeg" "$ASSETS_NATIVE/ffmpeg"
cp "$FF_DIST/ffprobe" "$ASSETS_NATIVE/ffprobe"
echo "-> ffmpeg + ffprobe OK"

if [ "$FLAVOR" = "enhanced" ]; then
    echo "==================== 3.5/5 Python3 + yt-dlp ===================="
    "$SCRIPT_DIR/build-python-android.sh"
    mkdir -p "$ASSETS_NATIVE/python3"
    cp -r "$SCRIPT_DIR/python-dist/arm64-v8a/python/." "$ASSETS_NATIVE/python3/"
    echo "-> python3 + yt-dlp OK ($(du -sh "$ASSETS_NATIVE/python3" | cut -f1))"
fi

echo "==================== 4/5 Web assets ===================="
rm -rf "$ASSETS_WEB"
mkdir -p "$ASSETS_WEB"
cp -r "$REPO_DIR/backend/web/." "$ASSETS_WEB/"
echo "-> web assets OK"

echo "==================== 5/5 Gradle ===================="
cd "$ANDROID_DIR"
if [ ! -f gradlew ]; then
    gradle wrapper --gradle-version 8.10.2 >/dev/null
fi
./gradlew "assemble${FLAVOR^}${BUILD_TYPE^}"

echo ""
echo "✅ APK en:"
ls -lh "$ANDROID_DIR/app/build/outputs/apk/$FLAVOR/$BUILD_TYPE/"

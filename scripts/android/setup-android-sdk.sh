#!/bin/bash
# Instala el Android SDK + NDK necesarios para compilar la app.
# No hace falta ser root: usa el SDK en el directorio indicado.

set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
NDK_VERSION="${NDK_VERSION:-27.1.12297006}"
PLATFORM="${ANDROID_PLATFORM:-android-35}"
BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-35.0.0}"

echo "== Android SDK -> $ANDROID_HOME =="
mkdir -p "$ANDROID_HOME/cmdline-tools"

# sdkmanager (commandline tools)
SDKMGR="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SDKMGR" ]; then
    echo "== Downloading commandline-tools =="
    TMP_ZIP="$(mktemp --suffix=.zip)"
    curl -sSL -o "$TMP_ZIP" \
        "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
    unzip -q -o "$TMP_ZIP" -d "$ANDROID_HOME/cmdline-tools"
    mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    rm -f "$TMP_ZIP"
fi

echo "== Aceptando licencias e instalando SDK + NDK =="
yes | "$SDKMGR" --licenses >/dev/null || true
"$SDKMGR" --install \
    "platform-tools" \
    "platforms;$PLATFORM" \
    "build-tools;$BUILD_TOOLS" \
    "ndk;$NDK_VERSION"

echo ""
echo "✅ SDK ready. Add to your shell:"
echo "   export ANDROID_HOME=$ANDROID_HOME"
echo "   export PATH=\$PATH:$ANDROID_HOME/platform-tools"

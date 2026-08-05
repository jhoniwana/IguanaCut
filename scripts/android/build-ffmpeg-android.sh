#!/bin/bash
# Compila FFmpeg + ffprobe estaticos para Android (arm64-v8a) usando el NDK.
#
# Requiere: Android NDK (ver scripts/android/setup-android-sdk.sh)
#   NDK_VERSION=27.1.12297006  ANDROID_HOME=<sdk>
#
# Salida: scripts/android/ffmpeg-dist/arm64-v8a/bin/{ffmpeg,ffprobe}

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_HOME="${ANDROID_HOME:?Define ANDROID_HOME (ruta del SDK)}"
NDK_VERSION="${NDK_VERSION:-27.1.12297006}"
FFMPEG_VERSION="${FFMPEG_VERSION:-n7.1}"
API="${ANDROID_API:-28}"
ARCH="arm64-v8a"

NDK="$ANDROID_HOME/ndk/$NDK_VERSION"
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64"
if [ ! -d "$TOOLCHAIN" ]; then
    echo "ERROR: no se encontro el NDK en $NDK" >&2
    echo "Ejecuta: scripts/android/setup-android-sdk.sh" >&2
    exit 1
fi

# FFmpeg para arm64 se compila con clang de aarch64
CROSS_PREFIX="$TOOLCHAIN/bin/aarch64-linux-android${API}-"
SYSROOT="$TOOLCHAIN/sysroot"

OUT="$SCRIPT_DIR/ffmpeg-dist/$ARCH"
WORK="$SCRIPT_DIR/.ffmpeg-build"
mkdir -p "$WORK" "$OUT/bin"

if [ ! -f "$WORK/ffmpeg/configure" ]; then
    echo "== Descargando FFmpeg $FFMPEG_VERSION =="
    git clone --depth 1 --branch "$FFMPEG_VERSION" \
        https://git.ffmpeg.org/ffmpeg.git "$WORK/ffmpeg"
fi

# x264: encoder de video para el re-encode (cortes precisos, crop, watermark).
# NOTA: --enable-gpl hace que el binario resultante sea GPL.
if [ ! -f "$WORK/x264/configure" ]; then
    echo "== Descargando x264 =="
    git clone --depth 1 https://code.videolan.org/videolan/x264.git "$WORK/x264"
fi
if [ ! -f "$OUT/x264/lib/libx264.a" ]; then
    echo "== Compilando x264 para $ARCH =="
    # El NDK solo trae llvm-*: x264 busca <prefix>ar/nm/ranlib/strings/strip
    for t in ar nm ranlib strings strip; do
        ln -sf "llvm-$t" "${CROSS_PREFIX}$t"
    done
    cd "$WORK/x264"
    CC="${CROSS_PREFIX}clang" ./configure --host=aarch64-linux-android \
        --cross-prefix="$CROSS_PREFIX" \
        --sysroot="$SYSROOT" --enable-static --disable-cli --disable-opencl \
        --disable-asm \
        --extra-cflags="-fPIC" --extra-asflags="-fPIC" --prefix="$OUT/x264"
    make -j"$(nproc)" && make install
    cd "$WORK/ffmpeg"
fi

cd "$WORK/ffmpeg"

echo "== Configurando FFmpeg para $ARCH =="
export PKG_CONFIG_PATH="$OUT/x264/lib/pkgconfig"
./configure \
    --prefix="$OUT" \
    --cc="${CROSS_PREFIX}clang" \
    --cxx="${CROSS_PREFIX}clang++" \
    --ar="$TOOLCHAIN/bin/llvm-ar" \
    --nm="$TOOLCHAIN/bin/llvm-nm" \
    --ranlib="$TOOLCHAIN/bin/llvm-ranlib" \
    --strip="$TOOLCHAIN/bin/llvm-strip" \
    --target-os=android \
    --arch=aarch64 \
    --cpu=armv8-a \
    --enable-cross-compile \
    --sysroot="$SYSROOT" \
    --enable-static \
    --disable-shared \
    --enable-small \
    --disable-programs \
    --disable-doc \
    --disable-avdevice \
    --disable-network \
    --disable-debug \
    --enable-ffmpeg \
    --enable-ffprobe \
    --enable-gpl \
    --enable-libx264 \
    --extra-cflags="-I$OUT/x264/include" \
    --extra-ldflags="-L$OUT/x264/lib" \
    --enable-pthreads \
    --pkg-config=pkg-config

echo "== Compilando (puede tardar varios minutos) =="
make -j"$(nproc)"
make install

echo ""
echo "Listo. Binarios en:"
ls -lh "$OUT/bin/"

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

cd "$WORK/ffmpeg"

echo "== Configurando FFmpeg para $ARCH =="
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
    --disable-everything \
    --enable-ffmpeg \
    --enable-ffprobe \
    --enable-demuxer=mov,matroska,mp3,aac,flac,ogg,webm,m4v,mpegts,wav \
    --enable-muxer=mov,matroska,mp3,aac,flac,ogg,webm,m4v,mpegts,wav \
    --enable-parser=aac,aac_latm,h264,hevc,mpegaudio,opus,vorbis,flac \
    --enable-decoder=aac,h264,hevc,mp3,opus,vorbis,flac,rawvideo,pcm_s16le,pcm_s16be \
    --enable-encoder=aac \
    --enable-protocol=file \
    --enable-bsf=h264_mp4toannexb,hevc_mp4toannexb \
    --enable-pthreads \
    --pkg-config=false

echo "== Compilando (puede tardar varios minutos) =="
make -j"$(nproc)"
make install

echo ""
echo "Listo. Binarios en:"
ls -lh "$OUT/bin/"

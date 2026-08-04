#!/bin/bash
# Compila CPython 3.12 para Android (arm64-v8a) usando el NDK y empaqueta
# yt-dlp + certifi (pure-python) en su site-packages.
#
# Requiere: Android NDK (ver setup-android-sdk.sh) y las dependencias
# ya compiladas en python-dist/arm64-v8a/{zlib,ffi,bzip2,lzma,openssl}
# (openssl la usa --with-openssl; el resto via CPPFLAGS/LDFLAGS).
#
# Salida: python-dist/arm64-v8a/python/ (arbol completo listo para assets)
#
# Uso: bash scripts/android/build-python-android.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/python-build"
DIST_DIR="$SCRIPT_DIR/python-dist/arm64-v8a"
PREFIX="$DIST_DIR/python"
SRC="$BUILD_DIR/target-src"
HOSTPY="$BUILD_DIR/hostpy"
NDK="${ANDROID_HOME:?Define ANDROID_HOME}/ndk/${NDK_VERSION:-27.1.12297006}"
CLANG="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android28-clang"
AR="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"

[ -x "$CLANG" ] || { echo "ERROR: NDK no encontrado ($CLANG)" >&2; exit 1; }
[ -d "$SRC" ] || { echo "ERROR: falta $SRC (descarga de CPython 3.12.10)" >&2; exit 1; }

# El host python se necesita durante el build (generadores); con --enable-shared
# requiere LD_LIBRARY_PATH a su lib.
export LD_LIBRARY_PATH="$HOSTPY/lib"
export PATH="$HOSTPY/bin:$PATH"

cd "$SRC"

if [ ! -f Makefile ]; then
    echo "== Configurando cross-compile =="
    ./configure \
        --host=aarch64-linux-android --build=x86_64-pc-linux-gnu \
        --prefix="$PREFIX" --enable-shared \
        --with-build-python="$HOSTPY/bin/python3.12" \
        --without-ensurepip --disable-ipv6 \
        --with-openssl="$DIST_DIR/openssl" --with-readline=no \
        CC="$CLANG" AR="$AR" \
        CFLAGS="-O2 -fPIC" \
        LDFLAGS="-L$DIST_DIR/zlib/lib -L$DIST_DIR/ffi/lib -L$DIST_DIR/bzip2/lib -L$DIST_DIR/lzma/lib" \
        CPPFLAGS="-I$DIST_DIR/zlib/include -I$DIST_DIR/ffi/include -I$DIST_DIR/bzip2/include -I$DIST_DIR/lzma/include" \
        ac_cv_file__dev_ptmx=yes ac_cv_file__dev_ptc=no \
        ac_cv_func_wcsftime=no ac_cv_func_ftime=no ac_cv_func_faccessat=no \
        ac_cv_func_link=no ac_cv_func_linkat=no ac_cv_buggy_getaddrinfo=no \
        ac_cv_little_endian_double=yes ac_cv_posix_semaphores_enabled=yes \
        ac_cv_func_sem_open=yes ac_cv_func_sem_timedwait=yes \
        ac_cv_func_sem_getvalue=yes ac_cv_func_sem_unlink=yes \
        ac_cv_func_shm_open=yes ac_cv_func_shm_unlink=yes \
        ac_cv_working_tzset=yes ac_cv_header_sys_xattr_h=no \
        ac_cv_func_getgrent=yes ac_cv_func_fexecve=no \
        ac_cv_func_getlogin_r=no ac_cv_func_getloadavg=no \
        ac_cv_func_sem_clockwait=no ac_cv_func_preadv2=no \
        ac_cv_func_pwritev2=no ac_cv_func_close_range=no \
        ac_cv_func_copy_file_range=no
    # Fix cross-compile: el configure detecta libb2 falsamente (no existe
    # en el NDK); el build debe usar la copia vendored de blake2.
    sed -i 's/^#define HAVE_LIBB2 1$/\/* undef: no libb2 en NDK *\//' pyconfig.h
fi

echo "== make =="
# Quitar modulos inviables en Android (NIS usa rpcsvc/yp_prot.h de glibc)
# y modulos de test que requieren herramientas del host (fallan en cross).
sed -i '24,25s/\b\(nis\|_xxtestfuzz\|_testbuffer\|_testcapi\|_testclinic\|_testimportmultiple\|_testinternalcapi\|_testmultiphase\|_testsinglephase\|_ctypes_test\|xxlimited_35\|xxlimited\)\b//g; 24,25s/  */ /g' Makefile
# Falsos positivos del cross-configure: libb2 y libuuid no existen en el NDK.
sed -i 's/^MODULE__BLAKE2_LDFLAGS=-lb2$/MODULE__BLAKE2_LDFLAGS=/' Makefile
sed -i 's/^MODULE__UUID_STATE=yes$/MODULE__UUID_STATE=disabled/; s/^MODULE__UUID_CFLAGS=.*$/MODULE__UUID_CFLAGS=/; s/^MODULE__UUID_LDFLAGS=.*$/MODULE__UUID_LDFLAGS=/' Makefile
# Misma limpieza en SHAREDMODS (linea 448: rutas Modules/<name>$(EXT_SUFFIX))
sed -i '448s/\b\(Modules\/nis\|Modules\/_uuid\|Modules\/_xxtestfuzz\|Modules\/_testbuffer\|Modules\/_testcapi\|Modules\/_testclinic\|Modules\/_testimportmultiple\|Modules\/_testinternalcapi\|Modules\/_testmultiphase\|Modules\/_testsinglephase\|Modules\/_ctypes_test\|Modules\/xxlimited_35\|Modules\/xxlimited\)\$(EXT_SUFFIX)//g; 448s/  */ /g' Makefile
# _posixshmem: bionic no implementa shm_open/shm_unlink (sin header en NDK)
sed -i '24,25s/ _posixshmem//g; 448s/Modules\/_posixshmem\$(EXT_SUFFIX)//g; 24,25s/  */ /g; 448s/  */ /g' Makefile
make -j"$(nproc)"

echo "== make install (prefix $PREFIX) =="
make install

# Optimizacion de tamano: strip de binarios/.so y limpieza de lo que no
# existe en Android (Tk/test suite). 295MB -> ~126MB.
STRIP="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip"
"$STRIP" "$PREFIX/bin/python3.12" "$PREFIX/lib/libpython3.12.so.1.0" 2>/dev/null || true
find "$PREFIX/lib/python3.12/lib-dynload" -name "*.so" -exec "$STRIP" {} + 2>/dev/null || true
rm -rf "$PREFIX/lib/python3.12/test" "$PREFIX/lib/python3.12/idlelib" \
       "$PREFIX/lib/python3.12/tkinter" "$PREFIX/lib/python3.12/turtledemo"

SITE="$PREFIX/lib/python3.12/site-packages"
mkdir -p "$SITE"

echo "== yt-dlp + certifi =="
# dl/ esta gitignored; descargar los wheels si no estan (pure-python, py3-none-any)
if [ ! -f "$SCRIPT_DIR/dl/yt_dlp.whl" ]; then
    YTDLP_URL=$(curl -sL https://pypi.org/pypi/yt-dlp/json | python3 -c "import json,sys; d=json.load(sys.stdin); print([u['url'] for u in d['urls'] if u['filename'].endswith('.whl')][0])")
    curl -sL -o "$SCRIPT_DIR/dl/yt_dlp.whl" "$YTDLP_URL"
fi
if [ ! -f "$SCRIPT_DIR/dl/certifi.whl" ]; then
    CERTIFI_URL=$(curl -sL https://pypi.org/pypi/certifi/json | python3 -c "import json,sys; d=json.load(sys.stdin); print([u['url'] for u in d['urls'] if u['filename'].endswith('.whl')][0])")
    curl -sL -o "$SCRIPT_DIR/dl/certifi.whl" "$CERTIFI_URL"
fi
if [ ! -d "$SITE/yt_dlp" ]; then
    unzip -q -o "$SCRIPT_DIR/dl/yt_dlp.whl" -d "$SITE"
fi
if [ ! -d "$SITE/certifi" ]; then
    unzip -q -o "$SCRIPT_DIR/dl/certifi.whl" -d "$SITE"
fi

echo ""
echo "OK: Python $(ls "$PREFIX/bin" | grep -m1 '^python3') en $PREFIX"
echo "    yt_dlp: $(ls "$SITE" | grep -c '^yt_dlp') archivos, certifi: $(ls "$SITE" | grep -c '^certifi') archivos"

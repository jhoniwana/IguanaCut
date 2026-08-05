# IguanaCut 🦎

<p align="center">
  <img src="logo.svg" alt="IguanaCut" width="140" />
</p>

Editor de video sin pérdida de calidad para **Android**, con servidor Go + FFmpeg embebidos en el APK (todo en uno, funciona offline).

Fork de [LosslessCut Web Edition](https://github.com/jhoniwana/losslesscut-web), a su vez basado en [LosslessCut](https://github.com/mifi/losslesscut) (GPL-2.0).

## Características

- **Corte sin pérdida** (`-c copy`): recorta video/audio sin re-encodear ni perder calidad
- **Flujo I/O**: marcá inicio y fin, creá clips y exportalos combinados o por separado
- **Recorte (crop)** y **marca de agua** aplicados en la exportación
- **Timeline con waveform** y arrastre para buscar (touch)
- **Home con gestión de archivos**: subí, renombrá, borrá y editá tus videos
- **Exportación** con barra de progreso y descarga del resultado
- **Flavor *enhanced*** (opcional): Python 3.12 + yt-dlp embebidos para descargar desde URL
- Tema oscuro "Iguana" (paleta del logo oficial)

## Estructura

```
android/             # Proyecto Gradle (Kotlin, Compose + WebView)
backend/             # Servidor Go (Gin) + wrapper FFmpeg
src/renderer/        # Frontend React (editor web embebido en el WebView)
scripts/android/     # Build scripts reproducibles (SDK, FFmpeg, Python, APK)
```

La app empaqueta todo: el servidor Go (ELF estático arm64), FFmpeg/ffprobe, el frontend compilado y —en el flavor enhanced— Python 3.12 + yt-dlp. No requiere red para editar.

## Build del APK

Requisitos: Node 22 + Yarn, Go, JDK 17-21, Android SDK + NDK (27.1.12297006), y espacio para compilar FFmpeg/Python (~10-15 min la primera vez).

```bash
# 1. SDK + NDK (una sola vez)
bash scripts/android/setup-android-sdk.sh

# 2. FFmpeg estático arm64 (una sola vez, ~15 min)
bash scripts/android/build-ffmpeg-android.sh

# 3. Python 3.12 + yt-dlp (solo si querés el flavor enhanced)
bash scripts/android/build-python-android.sh

# 4. APK completo (frontend + backend + assets + gradle)
bash scripts/android/build-android.sh play release      # sin yt-dlp (Play Store)
bash scripts/android/build-android.sh enhanced release  # con yt-dlp
```

Los APKs quedan en `android/app/build/outputs/apk/<flavor>/release/`.

También hay CI: [`.github/workflows/android-build.yml`](.github/workflows/android-build.yml) compila el APK *play* en cada push a `main` y lo publica como artifact.

### Desarrollo del frontend

```bash
corepack enable        # Yarn 4
yarn install
yarn dev:web           # dev server (puerto 3001, proxy al backend Go)
yarn build:web         # genera backend/web/ (los assets del APK)
yarn tsc               # type checking
```

## Licencia

[GPL-2.0](LICENSE) — igual que el proyecto original. Los créditos del editor pertenecen a sus autores originales (mifi et al. — LosslessCut).

# IguanaCut 🦎

<p align="center">
  <img src="logo.svg" alt="IguanaCut" width="140" />
</p>

Your **pocket video cutter**. Download any video (YouTube and hundreds of
sites via yt-dlp), mark the start and end, and export the fragment **without
losing quality** — all on your own phone.

**No subscriptions. No accounts. No servers. No ads.**
Install the APK and it even works on a plane: the app ships everything inside
(Go server, FFmpeg and —in the enhanced flavor— Python + yt-dlp).

## Features

- **Download from URL**: paste a YouTube link (or any site supported by
  yt-dlp) and save it straight to your phone
- **Lossless cutting** (`-c copy`): trim video/audio without re-encoding or
  losing quality — exact cuts
- **I/O workflow**: mark start and end, create clips and export them combined
  or separately
- **Crop** and **watermark** applied on export
- **Waveform timeline** with touch scrubbing
- **File & export management**: your videos and cuts with share (Android
  chooser), download and delete
- **Enhanced flavor** (optional): bundled Python 3.12 + yt-dlp
- **Play flavor**: no yt-dlp, suitable for Google Play distribution
- Dark "Iguana" theme (official logo palette)

## Structure

```
android/             # Gradle project (Kotlin, Compose + WebView)
backend/             # Go server (Gin) + FFmpeg wrapper
src/renderer/        # React frontend (web editor embedded in the WebView)
scripts/android/     # Reproducible build scripts (SDK, FFmpeg, Python, APK)
```

The app bundles everything: the Go server (static arm64 ELF), FFmpeg/ffprobe,
the compiled frontend and —in the enhanced flavor— Python 3.12 + yt-dlp. No
network required to edit.

## Download the APK

Release [v1.0.0](https://github.com/jhoniwana/IguanaCut/releases) has the
*play* APK ready to install (Android 9+). The *enhanced* flavor (with URL
downloads) is built locally:

```bash
bash scripts/android/build-android.sh enhanced release
```

> Note: sideloaded APKs ask for "install unknown apps" permission. The URL
> download is hidden in the *play* flavor because it doesn't bundle yt-dlp
> (Google Play requirement).

## Building the APK (for developers)

Requirements: Node 22 + Yarn, Go, JDK 17-21, Android SDK + NDK
(27.1.12297006), and room to compile FFmpeg/Python (~10-15 min the first
time).

```bash
# 1. SDK + NDK (once)
bash scripts/android/setup-android-sdk.sh

# 2. Static arm64 FFmpeg (once, ~15 min)
bash scripts/android/build-ffmpeg-android.sh

# 3. Python 3.12 + yt-dlp (only if you want the enhanced flavor)
bash scripts/android/build-python-android.sh

# 4. Full APK (frontend + backend + assets + gradle)
bash scripts/android/build-android.sh play release      # no yt-dlp (Play Store)
bash scripts/android/build-android.sh enhanced release  # with yt-dlp
```

APKs land in `android/app/build/outputs/apk/<flavor>/release/`.

CI is included: [`.github/workflows/android-build.yml`](.github/workflows/android-build.yml)
builds the *play* APK on every push to `main` and publishes the release.

### Frontend development

```bash
corepack enable        # Yarn 4
yarn install
yarn dev:web           # dev server (port 3001, proxies to the Go backend)
yarn build:web         # generates backend/web/ (the APK assets)
yarn tsc               # type checking
```

## License

[GPL-2.0](LICENSE) — same as the original project. Editor credits belong to
its original authors (mifi et al. — LosslessCut). IguanaCut is a fork of
[LosslessCut Web Edition](https://github.com/jhoniwana/losslesscut-web).

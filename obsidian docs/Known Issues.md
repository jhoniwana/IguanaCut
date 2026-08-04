# Known Issues

> 🐛 Problemas conocidos y su estado. Para contexto de arquitectura, ver [[BRAIN]]. Para la guía operativa, ver [[LosslessCut Web]].

---

## Exportación: duración incorrecta (RESUELTO)

**Problema**: Segmentos de 2s se exportaban de 3-10s.

**Causa**: `CutVideoLossless` usaba `-c copy` con input seeking, cortando en keyframes en vez del tiempo exacto.

**Solución**: Cambiar a `CutVideo` (re-encode con `libx264 ultrafast CRF 17`). Frame-accurate.

**Archivo**: `backend/internal/services/operation_service.go` — función `runExport()`

**Trade-off**: El re-encode es más lento que `-c copy` pero es la única forma de garantizar precisión de fotogramas. Para clips pequeños (segundos) es prácticamente instantáneo.

Ver [[BRAIN#8.1 Flujo de Edición (Single Video)]] para el pipeline completo de exportación.

---

## Metadatos de video no persistían (RESUELTO)

**Problema**: `SaveVideo` en una versión anterior del binario no guardaba metadata JSON a disco. Al recargar, los videos aparecían sin duración/format/códec.

**Solución**: Se recompiló el binario desde fuente con la corrección en `SaveVideo` (`backend/internal/storage/manager.go`). El binario actual (`lossless-cut-server`) tiene `SaveVideo` completamente funcional.

**Estado**: Resuelto en el binario actual. El script `fix_metadata.py` queda como herramienta de diagnóstico/legado, pero ya no es necesario para operación normal.

---

## Thumbnail onError causaba crash de React (RESUELTO)

**Problema**: Cuando fallaba la carga de un thumbnail (404, timeout), el callback `onError` usaba `innerHTML` para inyectar un fallback. Esto rompe el Virtual DOM de React y causaba un crash silencioso con pantalla blanca.

**Commit**: `d6bf73f` — `fix: thumbnail onError React crash (remove innerHTML)`

**Solución**: Se reemplazó `innerHTML` por estado React controlado. El fallback ahora es un ícono SVG renderizado por React.

**Archivo**: `src/renderer/src/App.web.tsx` — función `loadVideos()` y renderizado de thumbnails

---

## Thumbnails lentos en primera carga (MITIGADO)

**Problema**: El thumbnail se genera con un screenshot en t=0 vía FFmpeg. La primera vez puede tomar ~1-2 segundos. Además del crash por `innerHTML` (ver arriba).

**Solución**: La respuesta incluye `Cache-Control: public, max-age=86400`. La segunda carga es instantánea. Ya está implementado en `backend/internal/api/handlers/video.go:Thumbnail()`. El crash de React relacionado se arregló en commit `d6bf73f` (ver sección anterior).

---

## Audio drift en lossless cut (CONOCIDO)

**Problema**: Con `-c copy`, el audio puede desincronizarse ligeramente si el video tiene timestamps no estándar.

**Estado**: Ahora usamos re-encode por defecto, que resincroniza automáticamente. Si se vuelve a `CutVideoLossless`, aplicar `-async 1` para re-sincronizar audio.

**Archivo**: `backend/internal/ffmpeg/executor.go` — función `regularCut()`

---

## FFmpeg sin libx264 en Fedora (RESUELTO)

**Problema**: `dnf install ffmpeg` en Fedora no incluye libx264 por políticas de patentes de software.

**Solución**: Usar un build estático de [johnvansickle.com](https://johnvansickle.com/ffmpeg/) que soporta todos los códecs (libx264, libx265, AAC, etc.). Configurar la ruta en `backend/config/config.yaml` → `ffmpeg.path`.

**Ubicación recomendada**: `backend/ffmpeg-static` y `backend/ffprobe-static`

---

## Limpieza automática desactivada en desarrollo (CONFIG)

**Estado**: `storage.auto_cleanup` está en `false` en el `config.yaml` de desarrollo para no perder archivos durante pruebas. El `CleanupService` corre cada 1h y borra archivos >24h — en producción se recomienda activarlo.

**Archivos**: `backend/internal/services/cleanup_service.go`, `backend/internal/storage/manager.go:CleanupOldFiles()`

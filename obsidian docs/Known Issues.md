# Known Issues

## Exportación: duración incorrecta (RESUELTO)

**Problema**: Fragmentos de 2s se exportaban de 3-10s.

**Causa**: `CutVideoLossless` usaba `-c copy` con input seeking, cortando en keyframes en vez del tiempo exacto.

**Solución**: Cambiar a `CutVideo` (re-encode con libx264 ultrafast CRF 17). Frame-accurate.

**Archivo**: `backend/internal/services/operation_service.go:1179`

**Trade-off**: El re-encode es más lento que `-c copy` pero es la única forma de garantizar precisión de fotogramas. Para clips pequeños (segundos) es prácticamente instantáneo.

---

## Metadatos de video no persistían (RESUELTO)

**Problema**: `SaveVideo` en el binary original no guardaba metadata JSON a disco. Al recargar, los videos aparecían sin duración/format/códec.

**Solución**: 
1. Workaround inicial con proxy Python (`fix_metadata.py`)
2. Luego se recompiló el binary desde fuente con la corrección en `SaveVideo`

**Estado**: El binary actual (`lossless-cut-server`) tiene `SaveVideo` funcional. El proxy aún se usa como capa transparente.

---

## Thumbnails lentos en primera carga

**Problema**: El thumbnail se genera con un screenshot en t=0 vía FFmpeg. La primera vez puede tomar ~1-2 segundos.

**Solución**: La respuesta incluye `Cache-Control: public, max-age=86400`. La segunda carga es instantánea. Ya está implementado.

---

## Audio drift en lossless cut (CONOCIDO)

**Problema**: Con `-c copy`, el audio puede desincronizarse ligeramente si el video tiene timestamps no estándar.

**Estado**: Ahora usamos re-encode por defecto, que resincroniza automáticamente. Si se vuelve a `CutVideoLossless`, aplicar `-async 1` para re-sincronizar audio.

---

## FFmpeg sin libx264 en Fedora (RESUELTO)

**Problema**: `dnf install ffmpeg` en Fedora no incluye libx264 por políticas de patentes de software.

**Solución**: Usar static build de johnvansickle.com en `/home/jhon/lossless/backend/ffmpeg-static`. Soporta todos los códecs incluyendo libx264, libx265, AAC.

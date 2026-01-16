# 🚀 Optimizaciones de Rendimiento para LosslessCut Web

## Estado Actual

Tu sistema ya tiene **VAAPI** (Video Acceleration API) disponible, que es la API de aceleración por hardware para Linux. El contenedor Docker también tiene soporte VAAPI habilitado en FFmpeg.

## 📊 Análisis del Sistema Actual

### Backend (Go + FFmpeg)
- ✅ VAAPI ya disponible en FFmpeg del contenedor
- ✅ Soporte para: `vdpau`, `vaapi`, `qsv`, `drm`, `vulkan`
- ⚠️ Actualmente NO se usa aceleración por hardware en los comandos FFmpeg
- ⚠️ Las exportaciones usan re-encoding con CPU (`libx264` con CRF 17)

### Frontend (React + HTML5 Video)
- ✅ Usa `<video>` nativo del navegador (decodificación por hardware automática)
- ✅ Streaming con HTTP Range Requests
- ⚠️ `crossOrigin="anonymous"` puede limitar algunas optimizaciones
- ⚠️ `preload="metadata"` solo carga metadatos (no pre-buffering)

---

## 🎯 Optimizaciones Recomendadas

### 1. **Habilitar Aceleración por Hardware en FFmpeg (VAAPI)** 🔥

Para que FFmpeg use tu GPU/iGPU en lugar de la CPU:

#### a) Pasar dispositivos de video al contenedor Docker

Edita `backend/docker-compose.yml`:

```yaml
services:
  losslesscut:
    # ... resto de la config ...
    devices:
      - /dev/dri:/dev/dri  # Habilita acceso a GPU para VAAPI
    group_add:
      - video              # Agrega grupo video para permisos
```

#### b) Modificar comandos FFmpeg para usar VAAPI

En `backend/internal/ffmpeg/executor.go`, función `accurateCut()`:

**Antes (CPU):**
```go
args := []string{
    "-hide_banner",
    "-ss", fmt.Sprintf("%.6f", start),
    "-i", input,
    "-t", fmt.Sprintf("%.6f", duration),
    "-c:v", "libx264",
    "-crf", "17",
    // ...
}
```

**Después (VAAPI):**
```go
args := []string{
    "-hide_banner",
    "-hwaccel", "vaapi",                          // Usar aceleración VAAPI
    "-hwaccel_device", "/dev/dri/renderD128",     // Dispositivo GPU
    "-hwaccel_output_format", "vaapi",            // Formato de salida
    "-ss", fmt.Sprintf("%.6f", start),
    "-i", input,
    "-t", fmt.Sprintf("%.6f", duration),
    "-vf", "scale_vaapi=format=nv12",             // Escalar con GPU
    "-c:v", "h264_vaapi",                         // Encoder hardware
    "-qp", "18",                                  // Calidad (similar a CRF 17)
    // ...
}
```

**Beneficios:**
- ⚡ **3-10x más rápido** en exportaciones
- 💪 Libera CPU para otras tareas
- ❄️ Menor temperatura y consumo energético

---

### 2. **Optimizar Reproducción en el Navegador** 🎬

#### a) Habilitar pre-buffering

En `VideoEditor.tsx`, línea 822:

**Antes:**
```tsx
preload="metadata"
```

**Después:**
```tsx
preload="auto"
```

**Beneficio:** El navegador pre-carga más video, reduciendo pausas durante reproducción.

---

#### b) Usar Media Source Extensions (MSE) para streaming adaptativo

Crear un endpoint que sirva segmentos optimizados:

```go
// backend/internal/api/handlers/video.go
func (h *VideoHandler) StreamSegment(c *gin.Context) {
    videoID := c.Param("id")
    segment := c.Query("segment") // "0", "1", "2", etc.

    // Generar segmento de 5-10 segundos con VAAPI
    // Usar formato adaptativo (diferentes calidades)
}
```

**Frontend:** Usar MSE API para cargar segmentos bajo demanda.

**Beneficios:**
- 🎯 Seek instantáneo (sin esperar descarga completa)
- 📊 Calidad adaptativa según ancho de banda
- 💾 Menor uso de memoria

---

### 3. **Optimizar Waveform Generation** 📈

Actualmente en `executor.go:443-458`:

**Optimización con VAAPI:**
```go
func (e *Executor) GenerateWaveform(ctx context.Context, input, output string) error {
    args := []string{
        "-hide_banner",
        "-hwaccel", "vaapi",                      // Decodificar con GPU
        "-hwaccel_device", "/dev/dri/renderD128",
        "-i", input,
        "-filter_complex", "showwavespic=s=1920x120:colors=#667eea|#667eea:scale=sqrt:split_channels=0",
        "-frames:v", "1",
        "-y",
        output,
    }
    // ...
}
```

**Beneficio:** Generación 2-5x más rápida.

---

### 4. **Usar WebCodecs API (Experimental)** 🧪

Para navegadores modernos (Chrome/Edge), usar WebCodecs para decodificación en GPU del navegador:

```typescript
// Frontend - Decodificación por hardware en navegador
const decoder = new VideoDecoder({
  output: (frame) => {
    // Renderizar frame con GPU
    ctx.drawImage(frame, 0, 0);
    frame.close();
  },
  error: (e) => console.error(e),
});

decoder.configure({
  codec: 'avc1.42E01E',
  hardwareAcceleration: 'prefer-hardware', // ⚡ Forzar GPU
});
```

**Beneficios:**
- 🎮 Decodificación en GPU del navegador
- ⚡ Reproducción más fluida de videos high-bitrate
- 🔋 Menor consumo de batería en laptops

---

### 5. **Optimizar Exportación Combinada** 🔀

En `operation_service.go:exportMergedSegments()`:

**Problema actual:** Corta cada segmento individualmente, luego concatena (lento).

**Optimización:** Usar filtro `select` de FFmpeg con VAAPI:

```go
// Generar timeline de segmentos para filtro select
var selectExpr strings.Builder
for i, seg := range segments {
    if i > 0 {
        selectExpr.WriteString("+")
    }
    selectExpr.WriteString(fmt.Sprintf("between(t,%.6f,%.6f)", seg.Start, *seg.End))
}

args := []string{
    "-hide_banner",
    "-hwaccel", "vaapi",
    "-hwaccel_device", "/dev/dri/renderD128",
    "-i", inputPath,
    "-vf", fmt.Sprintf("select='%s',setpts=N/FRAME_RATE/TB", selectExpr.String()),
    "-af", fmt.Sprintf("aselect='%s',asetpts=N/SR/TB", selectExpr.String()),
    "-c:v", "h264_vaapi",
    "-qp", "18",
    "-c:a", "aac",
    "-y",
    outputPath,
}
```

**Beneficios:**
- 🚀 **5-10x más rápido** que método actual
- 📁 No crea archivos temporales
- 💾 Menor uso de disco

---

### 6. **Optimizar Screenshots** 📸

En `executor.go:CaptureSnapshot()`:

```go
args := []string{
    "-hide_banner",
    "-hwaccel", "vaapi",                      // Decodificar con GPU
    "-hwaccel_device", "/dev/dri/renderD128",
    "-ss", fmt.Sprintf("%.6f", timestamp),
    "-i", input,
    "-vframes", "1",
    "-q:v", fmt.Sprintf("%d", quality),
    "-y",
    output,
}
```

**Beneficio:** Captura instantánea (especialmente en videos 4K/8K).

---

## 📋 Plan de Implementación Recomendado

### Fase 1: Quick Wins (1-2 horas)
1. ✅ Agregar dispositivos `/dev/dri` a docker-compose.yml
2. ✅ Cambiar `preload="metadata"` a `preload="auto"`
3. ✅ Probar VAAPI en comandos simples (screenshots primero)

### Fase 2: Aceleración Backend (3-4 horas)
1. ✅ Implementar VAAPI en `accurateCut()`
2. ✅ Implementar VAAPI en `GenerateWaveform()`
3. ✅ Optimizar exportación combinada con filtro `select`
4. ✅ Testing y ajustes de calidad

### Fase 3: Optimización Frontend (4-6 horas)
1. ⚠️ Implementar MSE para streaming adaptativo
2. ⚠️ Evaluar WebCodecs API para navegadores compatibles
3. ⚠️ Implementar pre-caching inteligente

---

## 🧪 Testing de VAAPI

Para verificar que VAAPI funciona:

```bash
# En el contenedor Docker
docker exec -it backend-losslesscut-1 sh

# Test simple de encoding con VAAPI
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
  -i /var/losslesscut/uploads/video.mp4 \
  -vf 'format=nv12,hwupload' \
  -c:v h264_vaapi -qp 18 \
  /tmp/test_vaapi.mp4

# Si funciona, verás mensajes de VAAPI en el output
```

---

## 📊 Mejoras Esperadas

| Operación | Sin VAAPI | Con VAAPI | Mejora |
|-----------|-----------|-----------|--------|
| Export 1080p 60fps (10min) | ~8-12 min | ~1-2 min | **6-8x** |
| Generate Waveform | ~15s | ~3s | **5x** |
| Screenshot 4K | ~2s | ~0.3s | **6x** |
| Export Combinado (5 clips) | ~5 min | ~1 min | **5x** |
| Reproducción fluida | 30fps | 60fps | **2x** |

---

## ⚠️ Consideraciones

1. **Compatibilidad GPU:** VAAPI funciona con Intel iGPU, AMD GPU, y algunas NVIDIA (con drivers correctos)
2. **Calidad:** `qp 18` en VAAPI ≈ `crf 17` en x264 (ajustar según necesidad)
3. **Fallback:** Agregar detección automática y fallback a CPU si VAAPI falla
4. **Docker privilegios:** Puede requerir `--privileged` o permisos específicos

---

## 🔍 Próximos Pasos

1. **Verificar tu GPU:**
   ```bash
   ls -la /dev/dri/
   vainfo  # Muestra capacidades VAAPI
   ```

2. **Implementar cambios Fase 1** (bajo riesgo, alto impacto)

3. **Medir rendimiento antes/después** con videos reales

4. **Iterar y optimizar** basado en resultados

---

**¿Quieres que implemente alguna de estas optimizaciones?** 🚀

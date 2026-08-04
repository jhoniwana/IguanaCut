# Theme — Purple

> 🎨 Paleta de colores y branding del proyecto. Para la guía operativa, ver [[LosslessCut Web]]. Para la arquitectura completa, ver [[BRAIN]].

El tema original era "Gemstone Inc" (cyan `#00E5FF`, rosa `#FF148A`, dorado `#FFC800`). Se reemplazó por una paleta morada con estética TikTok/Instagram.

## Paleta

| Variable | Color | Tailwind |
|----------|-------|----------|
| `bg` | `#0a0a0f` | — |
| `surface` | `#12121a` | — |
| `card` | `#1a1a24` | — |
| `border` | `#2a2a3a` | — |
| `primary` | `#8B5CF6` | violet-500 |
| `secondary` | `#A78BFA` | violet-400 |
| `accent` | `#C084FC` | purple-400 |
| `danger` | `#ff4466` | — |
| `success` | `#00FF88` | — |
| `text` | `#ffffff` | — |
| `textSecondary` | `#b0b0c0` | — |
| `textMuted` | `#606070` | — |
| `gradient` | `linear-gradient(135deg, #8B5CF6, #A78BFA)` | — |
| `gradientAccent` | `linear-gradient(135deg, #A78BFA, #C084FC)` | — |

Definido en `src/renderer/src/App.web.tsx` (objeto `colors`).

## Archivos que usan la paleta

| Archivo | Uso |
|---------|-----|
| `src/renderer/src/App.web.tsx` | Paleta principal + header + footer |
| `src/renderer/src/components/VideoEditor.tsx` | Header del editor, controles |
| `src/renderer/src/components/MultiSourceEditor.tsx` | Editor multi-fuente |
| `src/renderer/src/components/MultiClipTimeline.tsx` | Timeline multi-clip |
| `src/renderer/src/components/SourcePanel.tsx` | Panel de fuentes de video |
| `src/renderer/src/components/BlurRegionSelector.tsx` | Selector de regiones de blur |
| `src/renderer/src/components/CropSelector.tsx` | Selector de crop + presets de color |
| `src/renderer/src/components/WatermarkSettings.tsx` | Configuración de watermark |

## Branding removido

- Logo `gemstonelogo` (`logo.png`) eliminado de `App.web.tsx` y `VideoEditor.tsx`
- Footer: "Gemstone Inc" → solo "Powered by FFmpeg"
- Comentarios "Gemstone Style" → eliminados
- Header: logo imagen → círculo con "LC" en degradado

## Logo actual

Círculo con degradado morado y las letras **LC** (LosslessCut). Tamaños por contexto:

| Contexto | Tamaño |
|----------|--------|
| Header landing page | 48×48 px |
| Header editor (desktop) | 44×44 px |
| Header editor (mobile) | 36×36 px |
| Welcome section | 70×70 px |
| Upload section | 80×80 px |

## Decisiones de diseño

- **Dark theme only** — no hay modo claro; el fondo es `#0a0a0f` (casi negro)
- **Glassmorphism** en modales y tarjetas (fondos semitransparentes con blur)
- **Animaciones** vía Framer Motion con spring physics para transiciones suaves
- **Mobile-first** con timeline vertical optimizado para touch
- **Gradientes** usados como acentos (botones, headers, logo) — nunca como fondos principales

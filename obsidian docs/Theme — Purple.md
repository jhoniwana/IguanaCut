# Theme — Purple

El tema original era "Gemstone Inc" (cyan `#00E5FF`, rosa `#FF148A`, dorado `#FFC800`). Se reemplazó por una paleta morada:

| Variable | Color |
|----------|-------|
| primary | `#8B5CF6` (violet-500) |
| secondary | `#A78BFA` (violet-400) |
| accent | `#C084FC` (purple-400) |
| gradient | `linear-gradient(135deg, #8B5CF6, #A78BFA)` |
| gradientAccent | `linear-gradient(135deg, #A78BFA, #C084FC)` |

## Archivos modificados

- `src/renderer/src/App.web.tsx` — Paleta + header + logo LC + footer
- `src/renderer/src/components/VideoEditor.tsx` — Paleta + header + logo LC
- `src/renderer/src/components/SourcePanel.tsx` — Paleta
- `src/renderer/src/components/BlurRegionSelector.tsx` — Paleta
- `src/renderer/src/components/CropSelector.tsx` — Paleta + colores presets
- `src/renderer/src/components/WatermarkSettings.tsx` — Paleta
- `src/renderer/src/components/MultiSourceEditor.tsx` — Paleta
- `src/renderer/src/components/MultiClipTimeline.tsx` — Paleta

## Branding removido

- Logo `gemstonelogo` (logo.png) eliminado de App.web.tsx y VideoEditor.tsx
- Footer: "Gemstone Inc" → solo "Powered by FFmpeg"
- Comentarios "Gemstone Style" → comentarios simples
- Header: logo imagen → círculo con "LC"

## Logo actual

El logo es un círculo con degradado morado y las letras "LC" (LosslessCut). Se usa en:
- Header de landing page (48x48)
- Header del editor (36-44px según mobile/desktop)
- Welcome section (70x70)
- Upload section del editor (80x80)

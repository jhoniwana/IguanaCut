# LosslessCut Web — Documentación

> 🧭 Mapa de Contenido (MOC) del proyecto. Cada nota está interconectada con `[[wikilinks]]`.

## Notas del vault

- [[LosslessCut Web]] — Descripción general, servicios, endpoints, configuración, shortcuts
- [[BRAIN]] — Compendio integral: arquitectura completa, backend Go, frontend React, Android, Docker, workflows
- [[Theme — Purple]] — Paleta de colores, branding, logo, archivos modificados
- [[Known Issues]] — Problemas conocidos, resueltos y pendientes

## Cómo navegar

- Si necesitas **entender el proyecto completo** → empieza por [[BRAIN]]
- Si buscas **cómo operar/desplegar** → [[LosslessCut Web]]
- Si algo **no funciona** → [[Known Issues]]
- Si trabajas en **UI/estilos** → [[Theme — Purple]]

## Últimos cambios (2026-08-04)

- **Git audit**: issues del historial de commits verificados y reflejados en docs
- **[[Known Issues]]** +2 issues resueltos: crash de React en thumbnails (`d6bf73f`), upload progress (`dd33807`)
- **Vault reorganizado**: todas las notas ahora están interconectadas con `[[wikilinks]]` → grafo navegable
- **[[BRAIN]]** creado: compendio integral de 1150+ líneas cubriendo toda la arquitectura
- **[[LosslessCut Web]]** actualizado: endpoints completos (45+), tabla de puertos por entorno, flujo de trabajo documentado
- **[[Theme — Purple]]** expandido: paleta completa, tabla de archivos, decisiones de diseño

### Histórico

- Segmentos ahora son frame-accurate (re-encode en vez de `-c copy`) → ver [[Known Issues#Exportación duración incorrecta (RESUELTO)]]
- Tema Gemstone → Purple (morado) → ver [[Theme — Purple]]
- Thumbnails reales en la lista de archivos → ver [[LosslessCut Web#Thumbnails]]
- Botón de renombrar archivos (PUT /api/videos/:id) → ver [[LosslessCut Web#Renombrar archivos]]
- Sesiones aisladas por X-Session-ID → ver [[LosslessCut Web#Headers]]
- FFmpeg static con libx264 → ver [[Known Issues#FFmpeg sin libx264 en Fedora (RESUELTO)]]

# Marca de Agua

Programa de escritorio para Windows que aplica tu logo como marca de agua y/o **comprime fotos y videos** por lotes, respetando el orden de subcarpetas. Todo se procesa **en tu PC**: nada se sube a internet.

## Descargar e instalar (para todo el equipo)

1. Entra a **[Releases](https://github.com/Applexby/Marca-de-agua/releases/latest)**.
2. Descarga `MarcaDeAgua-Setup-X.Y.Z.exe` y ábrelo. Se instala solo y crea un acceso directo en el escritorio.
3. Si Windows muestra "Windows protegió su PC", haz clic en **Más información → Ejecutar de todos modos** (aparece porque el programa no tiene firma digital de pago).

Solo se instala una vez. Cuando haya una versión nueva, el programa muestra arriba a la derecha **"Nueva versión disponible → Actualizar"**, la descarga y se reinicia ya actualizado.

## Cómo se usa

1. **Abrir carpeta** (o arrastrarla a la ventana). Se leen también **todas las subcarpetas**; en pantalla aparecen agrupadas por carpeta. Puedes filtrar Todo / Fotos / Videos y excluir carpetas completas con su casilla.
2. **Marca de agua** (interruptor arriba a la izquierda):
   - Activada: elige el logo (PNG transparente) y ajusta tamaño, opacidad, margen y posición para todo.
   - Desactivada: el programa solo **comprime / reduce** fotos y videos.
3. **Ajustar un solo archivo**: clic en la miniatura → se abre en grande. Arrastra el logo, rueda del mouse = tamaño. Afecta solo a ese archivo.
4. **Comparar calidad (fotos)**: en el editor, botones *Original* / *Resultado* y "Ver al 100%". Muestra el peso final, la resolución y la calidad JPG que se usará.
5. **Exportar**: se crea una carpeta al lado de la original (`<carpeta>_con_marca` o `<carpeta>_comprimido`) con **las mismas subcarpetas**. Los originales nunca se modifican.

### Fotos: peso máximo

| Límite | Resultado con una foto de 24 MP (6000 px) |
|---|---|
| 100 KB | ~1400 px, calidad 81 — preview rápida para celular |
| 300 KB | ~2200 px, calidad 84 — WhatsApp / redes |
| 500 KB | ~2800 px, calidad 83 — web liviana |
| 1 MB | ~4000 px, calidad 85 — web de buena calidad |
| 2 MB | 6000 px completos, calidad 83 — visualmente igual al original |
| 3 MB | 6000 px completos, calidad 88 |
| Sin límite | 6000 px, calidad 92 (~4–5 MB) |

El programa prefiere reducir un poco la resolución antes que bajar la calidad JPG a niveles que generan bandas de color o bloques.

### Videos (motor ffmpeg, el mismo de HandBrake)

- **Compresión**: Máxima calidad (CRF 18), Alta (21), Equilibrada (23, recomendada), Liviana (27), Muy liviana (31) o **Peso objetivo en MB** (2 pasadas).
- **Formato**: MP4 H.264 (compatible con todo) o H.265 (~40% menos peso).
- **Resolución**: original, 4K, 1440p, 1080p, 720p, 540p (vertical u horizontal).
- En el editor de un video: **Estimar peso final** (codifica una muestra corta) y **Reproducir original**.

## Publicar una actualización (desarrollo)

1. Cambiar `version` en `package.json`.
2. Commit y tag: `git tag vX.Y.Z && git push origin main --tags`.
3. GitHub Actions compila el instalador y lo publica en Releases. Los programas instalados avisan solos.

```bash
npm install
npm start        # abre la app
npm run dist     # genera el instalador en dist/
```

Tecnología: Electron + sharp (fotos) + ffmpeg (videos) + electron-updater (actualizaciones).

# Marca de Agua

Programa de escritorio para Windows que aplica tu logo como marca de agua a carpetas completas de fotos. Todo se procesa **en tu PC**: nada se sube a internet.

## Descargar e instalar (para todo el equipo)

1. Entra a **[Releases](https://github.com/Applexby/Marca-de-agua/releases/latest)**.
2. Descarga `MarcaDeAgua-Setup-X.Y.Z.exe` y ábrelo. Se instala solo y crea un acceso directo en el escritorio.
3. Si Windows muestra "Windows protegió su PC", haz clic en **Más información → Ejecutar de todos modos** (aparece porque el programa no tiene firma digital de pago).

Solo se instala una vez. Cuando haya una versión nueva, el programa muestra arriba a la derecha **"Nueva versión disponible → Actualizar"**, la descarga y se reinicia ya actualizado. También puedes hacer clic en el número de versión para buscar actualizaciones.

## Cómo se usa

1. **Abrir carpeta** (o arrastrarla a la ventana). Aparecen todas las fotos con la marca de agua ya aplicada en vista previa.
2. **Elegir logo**: un PNG con fondo transparente. Se recuerda para la próxima vez.
3. **Ajuste general** (panel izquierdo): tamaño, opacidad, margen y posición. Afecta a todas las fotos a la vez. Por defecto va al centro.
4. **Ajustar una sola foto**: haz clic en la miniatura. Se abre en grande:
   - Arrastra el logo para moverlo; la rueda del mouse sobre el logo lo agranda/achica.
   - Los cambios aplican **solo a esa foto** (aparece la etiqueta *Ajustada* en la miniatura).
   - "Volver al ajuste general" la devuelve a la configuración común.
   - Flechas ← → para pasar de foto, Esc para cerrar.
5. **Exportar**:
   - Formato **JPG** o **PNG**.
   - Por defecto mantiene la **resolución original**.
   - **Limitar peso a X KB** (como Lightroom): ideal para previews a clientes; ajusta la compresión automáticamente y, si hace falta, reduce un poco el tamaño.
   - **Reducir lado mayor** opcional (por ejemplo 2048 px).
   - Se guarda en la subcarpeta `con_marca` dentro de la carpeta original (o la que elijas). Los originales nunca se modifican.

Desmarca la casilla de una miniatura para no exportarla.

## Publicar una actualización (desarrollo)

1. Cambiar `version` en `package.json` (por ejemplo `1.0.1`).
2. Hacer commit y crear el tag: `git tag v1.0.1 && git push origin main --tags`.
3. GitHub Actions compila el instalador y lo publica en Releases. Los programas instalados avisan solos.

Desarrollo local:

```bash
npm install
npm start        # abre la app
npm run dist     # genera el instalador en dist/
```

Tecnología: Electron + sharp (libvips) para el procesamiento de imágenes + electron-updater para las actualizaciones.

# Bitácora Diaria por Área — Diseñarte México

PWA sin build step. Se sube tal cual a Vercel.

## Desplegar

1. Sube esta carpeta a un repo de GitHub e impórtalo en Vercel (Framework Preset: **Other**, sin build command).
   O bien: `npx vercel --prod` desde esta carpeta.
2. En Vercel → Settings → Environment Variables:

   | Variable | Valor |
   |---|---|
   | `GEMINI_API_KEY` | tu API key de Google AI Studio |
   | `GEMINI_MODEL` | `gemini-2.0-flash` (opcional) |

3. Redeploy. Listo.

Sin la key, la app funciona igual: la transcripción marca error (el audio se conserva y se puede escribir a mano) y al cerrar el día se arma un borrador con las entradas tal cual, editable antes de exportar.

## Archivos

```
index.html            shell: menú lateral morado (escritorio) y barra superior + cajón (celular)
styles.css            línea de diseño unificada de Diseñarte (estándar: Cotizador), solo tema claro
app.js                toda la app (router, captura, edición, PDF, asistente de uso, pantalla de carga)
api/transcribir.js    audio → texto (Gemini)
api/generar.js        entradas del día → actividades + conclusión (JSON estricto)
api/_gemini.js        cliente + glosario del negocio
sw.js                 service worker, funciona offline (sube CACHE al cambiar archivos)
manifest.webmanifest  instalable
fonts/                Poppins incluida (woff2 para la interfaz, TTF para el PDF)
img/textura.jpg       textura de fondo del manual (al 7 %)
icons/, favicon.ico   hoja morada con libreta; se generan con `node scripts/iconos.cjs`
```

## Qué falta respecto al spec

- **Supabase**: hoy los datos viven en el dispositivo (localStorage + IndexedDB para el audio). Falta Auth, tablas y RLS por área para que dos personas capturen en el mismo día compartido.
- **Logo en PDF**: el encabezado del PDF usa texto y el filete de marca; el ícono de la app está en `/icons/`.

## Atajos (escritorio)

`Espacio` grabar / detener · `Esc` cancelar grabación · `Ctrl+S` guardar edición

La grabación es de un toque: se abre la grabadora, se detiene con **Detener y guardar** o se descarta con la **X**.

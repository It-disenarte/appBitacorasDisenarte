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
index.html            shell
styles.css            tema según el manual de marca (#7C07A6, #A53692, #5CC6D0, #96989A), claro y oscuro
app.js                toda la app (router, captura, edición, PDF)
api/transcribir.js    audio → texto (Gemini)
api/generar.js        entradas del día → actividades + conclusión (JSON estricto)
api/_gemini.js        cliente + glosario del negocio
sw.js                 service worker, funciona offline
manifest.webmanifest  instalable
icons/                icono de la app (icon.svg es el original; los PNG salen de él)
```

## Qué falta respecto al spec

- **Supabase**: hoy los datos viven en el dispositivo (localStorage + IndexedDB para el audio). Falta Auth, tablas y RLS por área para que dos personas capturen en el mismo día compartido.
- **Logo en PDF**: el encabezado del PDF usa texto; el icono de la app ya está en `/icons/`.
- **Creato Display / Walkway**: se usan Poppins (títulos) y Montserrat (texto), las mismas del manual de marca, hasta tener las licencias.

## Atajos (escritorio)

`Espacio` grabar / detener · `Esc` cancelar grabación · `Ctrl+S` guardar edición

La grabación es de un toque: se abre la grabadora, se detiene con **Detener y guardar** o se descarta con la **X**.

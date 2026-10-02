/* Servidor de Bitácora para el VPS (Easypanel) y para probar en la computadora.
   Sirve la PWA y ejecuta las funciones de /api (las mismas que corren en Vercel).

     npm install
     npm start            → http://localhost:3000  (lee .env si existe)
*/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const RAIZ = fileURLToPath(new URL('.', import.meta.url));
const PUERTO = Number(process.env.PORT || 3000);
const MAX_BODY = 25 * 1024 * 1024;   // las notas de voz llegan en base64

// En la computadora se leen las variables de .env; en Easypanel vienen del panel.
if (existsSync(join(RAIZ, '.env'))) {
  for (const linea of readFileSync(join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/* Solo se publica la app; el código del servidor, .env y demás nunca. */
const PUBLICOS = new Set(['index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'favicon.ico']);
const CARPETAS = ['fonts', 'icons', 'img'];

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};
const COMPRIMIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.ttf']);

const SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)'
};

/* ---------------- funciones de /api ---------------- */
const handlers = new Map();
async function handler(nombre) {
  if (!handlers.has(nombre)) {
    const archivo = join(RAIZ, 'api', `${nombre}.js`);
    handlers.set(nombre, existsSync(archivo) ? import(pathToFileURL(archivo).href).then(m => m.default) : Promise.resolve(null));
  }
  return handlers.get(nombre);
}

/* Agrega a req/res lo mismo que Vercel: req.query, req.body, res.status(), res.json(). */
async function api(req, res, nombre) {
  res.setHeader('Cache-Control', 'no-store');
  if (nombre === 'salud') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  const fn = /^[a-z][a-z-]*$/.test(nombre) ? await handler(nombre) : null;
  if (!fn) return res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"No encontrado"}');

  req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const partes = []; let total = 0;
    for await (const p of req) {
      total += p.length;
      if (total > MAX_BODY) return res.writeHead(413, { 'Content-Type': 'application/json' }).end('{"error":"El envío es demasiado grande."}');
      partes.push(p);
    }
    const raw = Buffer.concat(partes).toString('utf8');
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
  }
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  await fn(req, res);
}

/* ---------------- archivos de la app ---------------- */
function rutaPublica(pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!extname(rel) && PUBLICOS.has(`${rel}.html`)) rel += '.html';   // como cleanUrls de Vercel
  const archivo = normalize(join(RAIZ, rel));
  if (!archivo.startsWith(RAIZ)) return null;
  const partes = rel.split('/');
  const ok = (partes.length === 1 && PUBLICOS.has(rel)) || (partes.length > 1 && CARPETAS.includes(partes[0]) && !partes.some(p => p.startsWith('.')));
  return ok ? archivo : null;
}

async function estatico(req, res, pathname) {
  const archivo = rutaPublica(pathname);
  const info = archivo && await stat(archivo).catch(() => null);
  if (!info?.isFile()) return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');

  const ext = extname(archivo);
  const etag = `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  // El código de la app se revalida siempre (lo actualiza el service worker); fuentes e imágenes duran una semana.
  const cabeceras = {
    'Content-Type': TIPOS[ext] || 'application/octet-stream',
    'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=604800',
    ETag: etag, Vary: 'Accept-Encoding'
  };
  if (req.headers['if-none-match'] === etag) return res.writeHead(304, cabeceras).end();

  let datos = await readFile(archivo);
  if (COMPRIMIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    datos = gzipSync(datos);
    cabeceras['Content-Encoding'] = 'gzip';
  }
  cabeceras['Content-Length'] = datos.length;
  res.writeHead(200, cabeceras);
  res.end(req.method === 'HEAD' ? undefined : datos);
}

/* ---------------- servidor ---------------- */
const servidor = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SEGURIDAD)) res.setHeader(k, v);
  try {
    const { pathname } = new URL(req.url, 'http://x');
    const ruta = decodeURIComponent(pathname);
    if (ruta.startsWith('/api/')) return await api(req, res, ruta.slice(5).replace(/\/$/, ''));
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    await estatico(req, res, ruta);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"Error del servidor."}');
    else res.end();
  }
});

servidor.listen(PUERTO, () => {
  console.log(`Bitácora escuchando en el puerto ${PUERTO}`);
  if (!process.env.DATABASE_URL) console.log('Aviso: falta DATABASE_URL; el login no funcionará hasta configurarla.');
  if (!process.env.GEMINI_API_KEY) console.log('Aviso: falta GEMINI_API_KEY; la app funciona sin IA.');
});

/* Easypanel detiene el contenedor con SIGTERM al desplegar: terminar lo que está en curso. */
function apagar() {
  servidor.close(async () => {
    await globalThis.poolBitacora?.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);

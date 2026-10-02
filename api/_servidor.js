/* Base de datos, sesiones y utilidades HTTP compartidas por las funciones de /api.
   Postgres en el VPS; las tablas se crean solas la primera vez (prefijo bitacora_
   para poder compartir la base con otras apps). */
import pg from 'pg';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { leerBody } from './_gemini.js';

export const PASSWORD_MIN = 8;
const COOKIE = 'bitacora_sesion';
const DIAS_SESION = 30;

/* ---------------- conexión ---------------- */
// Reusar el pool entre invocaciones de la misma instancia. En Vercel cada instancia abre
// el suyo: se mantiene chico para no agotar las conexiones de Postgres.
const global = globalThis;
function pool() {
  if (!process.env.DATABASE_URL) {
    throw new ErrorApi(500, 'Falta la variable DATABASE_URL en Vercel. Agrégala en Settings → Environment Variables y vuelve a desplegar.');
  }
  global.poolBitacora ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000
  });
  return global.poolBitacora;
}

export const q = async (sql, params) => (await pool().query(sql, params)).rows;

export async function transaccion(fn) {
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const r = await fn((sql, params) => c.query(sql, params).then(x => x.rows));
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS bitacora_usuarios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'usuario' CHECK (rol IN ('admin', 'usuario')),
  area TEXT NOT NULL DEFAULT 'Producción',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  debe_cambiar BOOLEAN NOT NULL DEFAULT FALSE,
  fallos INT NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acceso TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS bitacora_sesiones (
  token_hash TEXT PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES bitacora_usuarios(id) ON DELETE CASCADE,
  expira_en TIMESTAMPTZ NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bitacora_sesiones_usuario ON bitacora_sesiones(usuario_id);
CREATE TABLE IF NOT EXISTS bitacora_dias (
  usuario_id INT NOT NULL REFERENCES bitacora_usuarios(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  datos JSONB NOT NULL,
  actualizado BIGINT NOT NULL,
  guardado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, fecha)
);`;

/* Una vez por instancia. Si dos instancias lo corren a la vez y una choca, se reintenta. */
function esquema() {
  global.esquemaBitacora ??= q(ESQUEMA)
    .catch(() => q(ESQUEMA))
    .catch(e => { global.esquemaBitacora = null; throw e; });
  return global.esquemaBitacora;
}

/* ---------------- errores y respuestas ---------------- */
export class ErrorApi extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function mensajeDB(e) {
  if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT' || /timeout/i.test(e.message)) {
    return 'No se pudo conectar con la base de datos. Revisa que el Postgres del VPS esté encendido y que DATABASE_URL sea correcta.';
  }
  if (e.code === '28P01') return 'La base de datos rechazó el usuario o la contraseña de DATABASE_URL.';
  if (e.code === '3D000') return 'La base de datos indicada en DATABASE_URL no existe.';
  return 'Error del servidor. Intenta de nuevo.';
}

/* Las peticiones que cambian algo deben venir de la propia app. */
function mismoOrigen(req) {
  const origen = req.headers.origin;
  if (!origen) return true;
  try { return new URL(origen).host === req.headers.host; } catch { return false; }
}

/* Envuelve un manejador por método: { GET: fn, POST: fn }. Cada fn recibe (req, res, body). */
export function ruta(metodos) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const fn = metodos[req.method];
      if (!fn) throw new ErrorApi(405, 'Método no permitido');
      if (req.method !== 'GET' && !mismoOrigen(req)) throw new ErrorApi(403, 'Origen no permitido');
      await esquema();
      const body = req.method === 'GET' ? {} : await leerBody(req);
      const r = await fn(req, res, body || {});
      if (!res.headersSent) res.status(200).json(r ?? { ok: true });
    } catch (e) {
      if (e instanceof ErrorApi) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: mensajeDB(e) });
    }
  };
}

/* ---------------- validación ---------------- */
export function texto(v, campo, { min = 1, max = 120 } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new ErrorApi(400, min > 1 ? `${campo}: mínimo ${min} caracteres.` : `Falta ${campo.toLowerCase()}.`);
  if (s.length > max) throw new ErrorApi(400, `${campo}: máximo ${max} caracteres.`);
  return s;
}
export function correo(v) {
  const s = texto(v, 'El correo', { max: 160 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new ErrorApi(400, 'Escribe un correo válido.');
  return s;
}
export function password(v) {
  if (typeof v !== 'string' || v.length < PASSWORD_MIN) throw new ErrorApi(400, `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
  if (v.length > 200) throw new ErrorApi(400, 'La contraseña es demasiado larga.');
  return v;
}

/* ---------------- contraseñas (scrypt, incluido en Node) ---------------- */
const N = 16384, R = 8, P = 1, LARGO = 64;
const scryptP = (pw, sal) => new Promise((ok, mal) =>
  scrypt(pw, sal, LARGO, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (e, k) => e ? mal(e) : ok(k)));

export async function hashPassword(pw) {
  const sal = randomBytes(16);
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${(await scryptP(pw, sal)).toString('base64')}`;
}
export async function verificarPassword(guardado, pw) {
  try {
    const [alg, , , , sal, hash] = guardado.split('$');
    if (alg !== 'scrypt') return false;
    const esperado = Buffer.from(hash, 'base64');
    const k = await scryptP(pw, Buffer.from(sal, 'base64'));
    return k.length === esperado.length && timingSafeEqual(k, esperado);
  } catch { return false; }
}
/* Para que un correo inexistente tarde lo mismo que uno real. */
export const HASH_FALSO = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

/* ---------------- sesiones ---------------- */
const sha = (s) => createHash('sha256').update(s).digest('hex');

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}
function cookie(req, valor, maxAge) {
  const segura = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${segura}`;
}

export async function abrirSesion(req, res, usuarioId) {
  const token = randomBytes(32).toString('base64url');
  await q(`INSERT INTO bitacora_sesiones (token_hash, usuario_id, expira_en)
           VALUES ($1, $2, now() + interval '${DIAS_SESION} days')`, [sha(token), usuarioId]);
  await q('UPDATE bitacora_usuarios SET ultimo_acceso = now(), fallos = 0, bloqueado_hasta = NULL WHERE id = $1', [usuarioId]);
  // De paso, limpiar sesiones vencidas.
  q('DELETE FROM bitacora_sesiones WHERE expira_en < now()').catch(() => {});
  res.setHeader('Set-Cookie', cookie(req, token, DIAS_SESION * 86400));
}

export async function cerrarSesion(req, res) {
  const token = leerCookie(req, COOKIE);
  if (token) await q('DELETE FROM bitacora_sesiones WHERE token_hash = $1', [sha(token)]);
  res.setHeader('Set-Cookie', cookie(req, '', 0));
}

export const tokenActual = (req) => { const t = leerCookie(req, COOKIE); return t ? sha(t) : null; };

/* Usuario de la sesión o null. Renueva la sesión cuando le quedan menos de 15 días. */
export async function usuarioDe(req) {
  const t = tokenActual(req);
  if (!t) return null;
  const [u] = await q(`SELECT u.*, s.expira_en < now() + interval '15 days' AS renovar
    FROM bitacora_sesiones s JOIN bitacora_usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = $1 AND s.expira_en > now() AND u.activo`, [t]);
  if (!u) return null;
  if (u.renovar) q(`UPDATE bitacora_sesiones SET expira_en = now() + interval '${DIAS_SESION} days' WHERE token_hash = $1`, [t]).catch(() => {});
  return u;
}

export async function requiereUsuario(req) {
  const u = await usuarioDe(req);
  if (!u) throw new ErrorApi(401, 'Tu sesión terminó. Vuelve a entrar.');
  return u;
}
export async function requiereAdmin(req) {
  const u = await requiereUsuario(req);
  if (u.rol !== 'admin') throw new ErrorApi(403, 'Solo un administrador puede hacer esto.');
  return u;
}

/* Lo que el navegador puede ver de un usuario. */
export const publico = (u) => ({
  id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, area: u.area, debeCambiar: u.debe_cambiar
});

/* Para las funciones de IA, que no usan ruta(): responde 401 si no hay sesión. */
export async function conSesion(req, res) {
  try {
    await esquema();
    if (await usuarioDe(req)) return true;
    res.status(401).json({ error: 'Tu sesión terminó. Vuelve a entrar.' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e instanceof ErrorApi ? e.message : mensajeDB(e) });
  }
  return false;
}

/* Bitácora Diaria por Área — Diseñarte México
   PWA sin build step. Cada persona entra con su cuenta; sus bitácoras se guardan en
   Postgres (vía /api/dias) y se copian en el dispositivo para funcionar sin conexión.
   Los audios se quedan en el dispositivo (IndexedDB). IA vía funciones serverless en /api. */

const KEY_VIEJA = 'bitacora.v1';        // datos de antes de las cuentas, se pasan a la primera cuenta que entre
const KEY_SESION = 'bitacora.sesion';   // último usuario, para abrir sin conexión
const keyUsuario = (id) => `bitacora.u.${id}`;
const PASSWORD_MIN = 8;
const hoyISO = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

/* ---------------- estado ---------------- */
let YO = null;   // usuario con la sesión abierta
let S = { area: { nombre: '' }, usuario: { id: '', nombre: '' }, dias: {} };
let pendientes = new Set();   // fechas con cambios sin subir al servidor
let enServidor = new Set();   // fechas que ya existen en el servidor
let firmas = {};              // fecha → JSON del día la última vez que se guardó

const firma = ({ actualizado, ...resto }) => JSON.stringify(resto);
const diaVacio = (d) => d.estado === 'abierto' && !d.entradas.length && !d.bitacora;

function cargarLocal() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(keyUsuario(YO.id))); } catch {}
  S = { area: { nombre: YO.area }, usuario: { id: YO.id, nombre: YO.nombre }, dias: raw?.dias || {} };
  pendientes = new Set(raw?.pendientes || []);
  enServidor = new Set(raw?.enServidor || []);
  firmas = Object.fromEntries(Object.entries(S.dias).map(([f, d]) => [f, firma(d)]));
}
function guardarLocal() {
  if (!YO) return;
  try {
    localStorage.setItem(keyUsuario(YO.id), JSON.stringify({ dias: S.dias, pendientes: [...pendientes], enServidor: [...enServidor] }));
  } catch (e) { console.warn('No se pudo guardar en el dispositivo:', e.message || e); }
}

/* Guarda en el dispositivo y programa la subida de los días que cambiaron. */
function save() {
  for (const [f, d] of Object.entries(S.dias)) {
    const j = firma(d);
    if (firmas[f] === j) continue;
    firmas[f] = j;
    if (!enServidor.has(f) && diaVacio(d)) continue;   // un día vacío que nunca se subió no hace falta subirlo
    d.actualizado = Date.now();
    pendientes.add(f);
  }
  guardarLocal();
  if (pendientes.size) programarSync();
  pintarEstado();
}

/* ---------------- servidor ---------------- */
const espera = (ms) => new Promise(r => setTimeout(r, ms));

/* fetch con JSON. Lanza Error con el mensaje del servidor; e.offline si no hubo red. */
async function api(url, metodo = 'GET', datos) {
  let r;
  try {
    r = await fetch(url, {
      method: metodo, credentials: 'same-origin',
      headers: datos ? { 'Content-Type': 'application/json' } : {},
      body: datos ? JSON.stringify(datos) : undefined
    });
  } catch {
    const e = new Error('Sin conexión. Revisa tu internet e intenta de nuevo.'); e.offline = true; throw e;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `Error del servidor (${r.status}).`); e.status = r.status; throw e; }
  return j;
}

/* Para las funciones de IA: si la sesión venció, vuelve al login. */
async function apiIA(url, datos) {
  try { return await api(url, 'POST', datos); }
  catch (e) { if (e.status === 401) sesionVencida(); throw e; }
}

/* ---------------- sincronización ---------------- */
let syncTimer = 0, sincronizando = null, estadoSync = 'ok', ultimaBajada = 0;

function programarSync(ms = 1500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sincronizar(), ms);
}

/* Un día del servidor reemplaza al local, salvo que el local tenga cambios más nuevos
   o una transcripción en curso. */
function aplicarDelServidor(s) {
  const local = S.dias[s.fecha];
  enServidor.add(s.fecha);
  if (local && (local.actualizado || 0) === s.actualizado) { pendientes.delete(s.fecha); return false; }
  if (local && pendientes.has(s.fecha) && (local.actualizado || 0) > s.actualizado) return false;
  if (local?.entradas.some(e => e.estado === 'procesando')) { pendientes.add(s.fecha); return false; }
  S.dias[s.fecha] = { ...s.datos, fecha: s.fecha, actualizado: s.actualizado };
  firmas[s.fecha] = firma(S.dias[s.fecha]);
  pendientes.delete(s.fecha);
  return true;
}

/* Sube los días pendientes (y con bajar, primero descarga los de la cuenta).
   Devuelve true si terminó sin errores. Con manual, lanza el error para mostrarlo. */
function sincronizar({ bajar = false, manual = false } = {}) {
  if (!YO) return Promise.resolve(false);
  if (sincronizando) return manual || bajar ? sincronizando.then(() => sincronizar({ bajar, manual })) : sincronizando;
  clearTimeout(syncTimer);
  const yo = YO;
  sincronizando = (async () => {
    estadoSync = 'sincronizando'; pintarEstado();
    let cambio = false;
    try {
      if (bajar) {
        const { dias } = await api('/api/dias');
        if (YO !== yo) return false;
        dias.forEach(s => { if (aplicarDelServidor(s)) cambio = true; });
        ultimaBajada = Date.now();
        guardarLocal();
      }
      for (let vuelta = 0; pendientes.size && vuelta < 20; vuelta++) {
        [...pendientes].filter(f => !S.dias[f]).forEach(f => pendientes.delete(f));
        const lote = [...pendientes].slice(0, 20).map(f => ({ fecha: f, datos: S.dias[f], actualizado: S.dias[f].actualizado || Date.now() }));
        if (!lote.length) break;
        const r = await api('/api/dias', 'PUT', { dias: lote });
        if (YO !== yo) return false;
        lote.forEach(x => {
          enServidor.add(x.fecha);
          // Si se editó mientras se subía, se queda pendiente para la siguiente vuelta.
          if ((S.dias[x.fecha]?.actualizado || 0) === x.actualizado) pendientes.delete(x.fecha);
        });
        r.masNuevos.forEach(s => { pendientes.delete(s.fecha); if (aplicarDelServidor(s)) cambio = true; });
        guardarLocal();
      }
      estadoSync = 'ok';
      return true;
    } catch (e) {
      if (e.status === 401) { sesionVencida(); return false; }
      estadoSync = e.offline ? 'sin-conexion' : 'error';
      console.warn('Sincronización:', e.message || e);
      programarSync(30000);
      if (manual) throw e;
      return false;
    } finally {
      sincronizando = null;
      pintarEstado();
      if (cambio) refrescar();
    }
  })();
  return sincronizando;
}

/* Vuelve a pintar con lo que llegó del servidor, sin interrumpir a quien está escribiendo. */
let refrescoPendiente = false;
function refrescar() {
  const a = document.activeElement;
  const escribiendo = a && (a.isContentEditable || /input|textarea/i.test(a.tagName)) && $('#main').contains(a);
  if (escribiendo || $('.sheet') || rec) { refrescoPendiente = true; return; }
  if (YO) render();
}

function pintarEstado() {
  const caja = $('#pie-estado');
  if (!caja || !YO) return;
  const n = pendientes.size;
  const [clase, txt] =
    estadoSync === 'sincronizando' ? ['sincronizando', 'Sincronizando…'] :
    estadoSync === 'sin-conexion' ? ['pendiente', n ? `Sin conexión · ${n} día${n === 1 ? '' : 's'} por subir` : 'Sin conexión'] :
    estadoSync === 'error' ? ['error', 'No se pudo sincronizar'] :
    n ? ['pendiente', 'Cambios por subir'] : ['ok', 'Sincronizado'];
  caja.dataset.estado = clase;
  $('#pie-estado-txt').textContent = txt;
}

addEventListener('online', () => { if (YO) sincronizar(); });
document.addEventListener('visibilitychange', () => {
  if (!YO) return;
  // Al salir de la app se intenta subir lo pendiente; al volver, se baja lo capturado en otro dispositivo.
  if (document.visibilityState === 'hidden' && pendientes.size) sincronizar();
  if (document.visibilityState === 'visible' && Date.now() - ultimaBajada > 5 * 60000) sincronizar({ bajar: true });
});

function dia(fecha = hoyISO()) {
  if (!S.dias[fecha]) S.dias[fecha] = { fecha, estado: 'abierto', entradas: [], bitacora: null, revisado: false };
  return S.dias[fecha];
}
const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------------- audio en IndexedDB ---------------- */
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('bitacora-audio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('audios');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function putAudio(id, blob) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('audios', 'readwrite');
    tx.objectStore('audios').put(blob, id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function getAudio(id) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('audios', 'readonly');
    const q = tx.objectStore('audios').get(id);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}

/* ---------------- utilidades UI ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = (s = '') => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Íconos de línea de lucide (trazo 2, extremos redondeados). */
const ICONOS = {
  'calendar-check': '<path d="M8 2v4M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18M9 16l2 2 4-4"/>',
  'calendar-range': '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M3 10h18M8 2v4M17 14h-6M13 18H7M7 14h.01M17 18h.01"/>',
  'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  'keyboard': '<path d="M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  'mic': '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
  'file-down': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M12 18v-6M9 15l3 3 3-3"/>',
  'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
  'ellipsis-vertical': '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'trash': '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>',
  'x': '<path d="M18 6 6 18M6 6l12 12"/>',
  'square': '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  'plus': '<path d="M5 12h14M12 5v14"/>',
  'lock-open': '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'check-circle': '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7M12 19V5"/>',
  'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  'share': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'loader': '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5M22 8l-5 5"/>',
  'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  'key': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'
};
const ico = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[n]}</svg>`;
const vacio = (texto) => `<div class="empty" data-guide="vacio"><img src="icons/hoja.svg" alt=""><p>${texto}</p></div>`;

/* Pantalla de carga: cubre la app mientras algo espera al servidor o se procesa.
   Bloquea clics desde el primer instante (evita el doble envío) y se ve tras 180 ms. */
function cargando(mensaje) {
  const c = el(`<div class="carga" role="status" aria-live="polite"><div class="carga-tarjeta">${ico('loader', 'spin')}<span>${esc(mensaje)}</span></div></div>`);
  document.body.append(c);
  return () => c.remove();
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function fechaLarga(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}
function fechaCorta(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  return `${dias[dt.getDay()]} ${d} de ${MESES[m - 1]}`;
}
const horaAhora = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });

function lunesDe(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return hoyISO(dt);
}
function rangoSemana(lunes) {
  const [y, m, d] = lunes.split('-').map(Number);
  const ini = new Date(y, m - 1, d);
  const fin = new Date(y, m - 1, d + 6);
  const mismoMes = ini.getMonth() === fin.getMonth();
  return mismoMes
    ? `${ini.getDate()} – ${fin.getDate()} de ${MESES[fin.getMonth()]} de ${fin.getFullYear()}`
    : `${ini.getDate()} de ${MESES[ini.getMonth()]} – ${fin.getDate()} de ${MESES[fin.getMonth()]} de ${fin.getFullYear()}`;
}

function snack(msg) {
  const s = el(`<div class="snackbar">${esc(msg)}</div>`);
  $('#snackbar-root').append(s);
  setTimeout(() => s.remove(), 4000);
}

function sheet(html, { onMount } = {}) {
  const root = $('#sheet-root');
  const scrim = el('<div class="scrim"></div>');
  const s = el(`<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`);
  const close = () => { scrim.remove(); s.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  scrim.onclick = close;
  document.addEventListener('keydown', onKey);
  root.append(scrim, s);
  onMount?.(s, close);
  s.querySelector('textarea,input,button')?.focus();
  return close;
}

/* ---------------- router ---------------- */
let vista = 'hoy';
let fechaVista = hoyISO();
let tabHistorial = 'dias';

function nav(v, fecha) {
  if (v === 'usuarios' && YO?.rol !== 'admin') v = 'hoy';
  vista = v;
  if (fecha) fechaVista = fecha;
  refrescoPendiente = false;
  if (v === 'usuarios') { usuariosLista = null; cargarUsuarios(); }
  document.querySelectorAll('[data-nav]').forEach(b => {
    const on = b.dataset.nav === (v === 'bitacora' ? 'hoy' : v);
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  });
  cerrarMenu();
  cerrarGuia();
  render();
  $('#main').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
  if (v !== 'usuarios') guiaAlEntrar();   // la de Usuarios sale cuando termina de cargar la lista
}
document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => nav(b.dataset.nav, hoyISO()));

function render() {
  const m = $('#main');
  m.innerHTML = '';
  if (vista === 'hoy') m.append(...vistaHoy());
  else if (vista === 'bitacora') m.append(...vistaBitacora());
  else if (vista === 'historial') m.append(...vistaHistorial());
  else if (vista === 'usuarios') m.append(...vistaUsuarios());
  else m.append(...vistaPerfil());
  m.classList.toggle('con-dock', Boolean(m.querySelector('.capture-dock')));
  pintarMenu();
}

/* Encabezado de pantalla: contexto pequeño en gris y título en morado. */
function encabezado(titulo, contexto, estado, extra = '') {
  return el(`<header class="encabezado">
    <div data-guide="encabezado">
      ${contexto ? `<p class="contexto">${esc(contexto)}</p>` : ''}
      <h1>${esc(titulo)}</h1>
      ${estado ? `<div class="encabezado-estado"><span class="chip-estado" data-estado="${estado}">${estado}</span></div>` : ''}
    </div>
    <div class="encabezado-acciones">${extra}</div>
  </header>`);
}

/* ---------------- menú lateral ---------------- */
const esEscritorio = () => matchMedia('(min-width: 768px)').matches;
let menuPorGuia = false;

function abrirMenu(porGuia = false) {
  if (esEscritorio()) return;
  menuPorGuia = porGuia;
  $('#sidebar').classList.add('abierto');
  $('#drawer-scrim').classList.toggle('visible', !porGuia);
  $('#menu-abrir').setAttribute('aria-expanded', 'true');
}
function cerrarMenu() {
  menuPorGuia = false;
  $('#sidebar').classList.remove('abierto');
  $('#drawer-scrim').classList.remove('visible');
  $('#menu-abrir').setAttribute('aria-expanded', 'false');
}
$('#menu-abrir').onclick = () => abrirMenu();
$('#menu-cerrar').onclick = cerrarMenu;
$('#drawer-scrim').onclick = cerrarMenu;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sidebar').classList.contains('abierto') && !guiaActual) cerrarMenu(); });

let promptInstalar = null;
const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstalar = e; pintarMenu(); });
window.addEventListener('appinstalled', () => { promptInstalar = null; pintarMenu(); });
$('#instalar').onclick = async () => {
  if (!promptInstalar) return;
  cerrarMenu();
  promptInstalar.prompt();
  await promptInstalar.userChoice.catch(() => {});
  promptInstalar = null; pintarMenu();
};

$('#asistente-switch').onclick = () => {
  const on = !asistenteActivo();
  setAsistente(on);
  snack(on ? 'Asistente encendido. Aparecerá al entrar a cada pantalla.' : 'Asistente apagado. Puedes ver la guía desde el menú o con el botón ?.');
};
$('#ver-guia').onclick = () => { cerrarMenu(); abrirGuia(); };
$('#ayuda').onclick = () => abrirGuia();
$('#cambiar-pass').onclick = () => { cerrarMenu(); cambiarPassword(); };
$('#salir').onclick = () => salir();
$('#sincronizar').onclick = async () => {
  cerrarMenu();
  const listo = cargando('Sincronizando…');
  try { await sincronizar({ bajar: true, manual: true }); snack('Todo está sincronizado.'); }
  catch (e) { snack(e.offline ? 'Sin conexión. Tus cambios se subirán cuando vuelva el internet.' : e.message); }
  finally { listo(); }
};

function pintarMenu() {
  $('#asistente-switch').setAttribute('aria-checked', String(asistenteActivo()));
  $('#instalar').hidden = !promptInstalar || instalada();
  if (!YO) return;
  $('[data-nav="usuarios"]').hidden = YO.rol !== 'admin';
  $('#pie-nombre').textContent = YO.nombre;
  $('#pie-area').textContent = `${YO.rol === 'admin' ? 'Administrador · ' : ''}Área de ${S.area.nombre}`;
  pintarEstado();
}

/* ---------------- pantalla: Hoy ---------------- */
function vistaHoy() {
  const d = dia(fechaVista);
  const abierto = d.estado === 'abierto';
  const sinEntradas = !d.entradas.length;
  const bar = encabezado(S.area.nombre, fechaCorta(d.fecha), d.estado,
    abierto ? `<button class="btn contorno" id="cerrar-dia" data-guide="cerrar-dia" ${sinEntradas ? 'disabled' : ''} title="${sinEntradas ? 'Captura al menos una entrada para cerrar el día' : 'Cerrar el día y generar la bitácora'}">${ico('calendar-check')}Cerrar día</button>` : '');
  bar.querySelector('#cerrar-dia')?.addEventListener('click', () => {
    if (sinEntradas) return snack('Captura al menos una entrada para cerrar el día.');
    confirmarCierre();
  });

  const page = el(`<div class="page"></div>`);

  if (!d.entradas.length) {
    page.append(el(vacio(abierto
      ? 'Aquí no hay nada todavía. Toca Grabar para dictar la primera entrada del día o el teclado para escribirla.'
      : 'Este día se cerró sin entradas.')));
  } else {
    const lista = el('<div class="entradas" data-guide="entradas"></div>');
    [...d.entradas].reverse().forEach(e => lista.append(entradaCard(e, d)));
    page.append(el('<div class="section-title">Entradas del día</div>'), lista);
  }

  const nodes = [bar, page];

  if (abierto) {
    const dock = el(`<div class="capture-dock"><div class="capture-row">
      <button class="fab-sec" id="fab-texto" data-guide="boton-escribir" aria-label="Escribir entrada" title="Escribir entrada">${ico('keyboard')}</button>
      <button class="fab" id="fab" data-guide="boton-grabar" aria-label="Grabar nota de voz">${ico('mic')}<span>Grabar</span></button>
    </div></div>`);
    dock.querySelector('#fab').onclick = () => { if (!rec) iniciarGrabacion(); };
    dock.querySelector('#fab-texto').onclick = abrirTexto;
    nodes.push(dock);
  } else {
    const dock = el(`<div class="capture-dock">
      <button class="fab" id="ver-bit" data-guide="ver-bitacora">${ico('file-text')}<span>Ver bitácora</span></button>
    </div>`);
    dock.querySelector('#ver-bit').onclick = () => nav('bitacora', d.fecha);
    nodes.push(dock);
  }
  return nodes;
}

function entradaCard(e, d) {
  const inicial = (e.usuarioNombre || 'T').trim()[0].toUpperCase();
  const c = el(`<article class="entrada" data-id="${e.id}">
    <div class="avatar">${esc(inicial)}</div>
    <div class="entrada-body">
      <div class="entrada-meta">
        <span>${esc(e.hora)}</span><span>·</span><span>${esc(e.usuarioNombre)}</span>
        ${e.tipo === 'audio' ? `<span>·</span>${ico('mic')}` : ''}
      </div>
      <p class="entrada-texto ${e.estado !== 'listo' ? 'pendiente' : ''}">${esc(
        e.estado === 'procesando' ? 'Transcribiendo…' :
        e.estado === 'error' ? 'No se pudo transcribir. El audio está guardado.' : e.contenido)}</p>
      ${e.estado === 'error' && e.errorIA ? `<div class="aviso-detalle">${esc(e.errorIA)}</div>` : ''}
    </div>
    <div class="entrada-acciones">
      ${e.tipo === 'audio' ? `<button class="mini" data-act="play" aria-label="Reproducir audio" title="Reproducir audio">${ico('play')}</button>` : ''}
      <button class="mini" data-act="menu" aria-label="Opciones de la entrada" title="Editar o eliminar">${ico('ellipsis-vertical')}</button>
    </div>
  </article>`);

  if (e.estado === 'error') {
    const fila = el('<div class="btn-row" style="margin-top:8px;gap:6px"></div>');
    const rb = el('<button class="btn peligro sm">Reintentar</button>');
    rb.onclick = async () => {
      const audio = await getAudio(e.id);
      if (!audio) return snack('El audio no está en este dispositivo. Escribe el texto.');
      e.estado = 'procesando'; e.errorIA = ''; save(); render();
      transcribir(e, audio);
    };
    const eb = el('<button class="btn contorno sm">Escribir el texto</button>');
    eb.onclick = () => editarEntrada(e, d);
    fila.append(rb, eb);
    c.querySelector('.entrada-body').append(fila);
  }
  c.querySelector('[data-act="play"]')?.addEventListener('click', () => reproducir(e.id));
  c.querySelector('[data-act="menu"]').onclick = () => menuEntrada(e, d);
  return c;
}

async function reproducir(id) {
  const blob = await getAudio(id);
  if (!blob) return snack('El audio no está disponible en este dispositivo.');
  const a = new Audio(URL.createObjectURL(blob));
  a.play();
}

function menuEntrada(e, d) {
  sheet(`<h2>Entrada de ${esc(e.hora)}</h2>
    <button class="list-opt" data-a="editar">${ico('pencil')}Editar texto</button>
    <button class="list-opt peligro" data-a="borrar">${ico('trash')}Eliminar entrada</button>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="editar"]').onclick = () => { close(); editarEntrada(e, d); };
      s.querySelector('[data-a="borrar"]').onclick = () => {
        close();
        d.entradas = d.entradas.filter(x => x.id !== e.id);
        save(); render(); snack('Entrada eliminada. El audio se conserva.');
      };
    } });
}

function editarEntrada(e, d) {
  sheet(`<h2>Editar entrada</h2>
    <textarea class="field" id="t">${esc(e.contenido || '')}</textarea>
    <div class="sheet-actions"><button class="btn fantasma" data-a="cancel">Cancelar</button><button class="btn primario" data-a="ok">Guardar</button></div>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="ok"]').onclick = () => {
        e.contenido = s.querySelector('#t').value.trim();
        e.estado = 'listo'; save(); close(); render(); snack('Entrada guardada');
      };
    } });
}

/* ---------------- captura ---------------- */
let rec = null, chunks = [], recStart = 0, recTimer = null, stream = null, analyser = null, rafId = null;

/* Nada de menús contextuales ni lupa de selección al presionar la interfaz. */
document.addEventListener('contextmenu', e => {
  if (e.target.closest('button, .fab, .rec-overlay')) e.preventDefault();
});

function abrirTexto() {
  sheet(`<h2>Escribir entrada</h2>
    <textarea class="field" id="t" placeholder="¿Qué pasó o qué hiciste?"></textarea>
    <div class="sheet-actions"><button class="btn fantasma" data-a="cancel">Cancelar</button><button class="btn primario" data-a="ok">Agregar</button></div>`,
  { onMount: (s, close) => {
      const ta = s.querySelector('#t');
      const ok = () => {
        const v = ta.value.trim(); if (!v) return close();
        agregarEntrada({ tipo: 'texto', contenido: v, estado: 'listo' }); close();
      };
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="ok"]').onclick = ok;
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ok(); });
    } });
}

function agregarEntrada(datos) {
  const d = dia(fechaVista);
  const e = { id: uid(), hora: horaAhora(), usuarioId: S.usuario.id, usuarioNombre: S.usuario.nombre, contenido: '', transcripcionRaw: '', ...datos };
  d.entradas.push(e); save(); render();
  return e;
}

let recOverlay = null;
async function iniciarGrabacion() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return snack('No se pudo usar el micrófono. Revisa los permisos o escribe la entrada.');
  }
  chunks = [];
  rec = new MediaRecorder(stream);
  rec.ondataavailable = ev => chunks.push(ev.data);
  rec.start();
  recStart = Date.now();

  recOverlay = el(`<div class="rec-overlay"><div class="rec-card">
    <button class="mini rec-x" id="rec-cancel" aria-label="Cancelar grabación" title="Descartar grabación">${ico('x')}</button>
    <div class="rec-wave">${'<span class="rec-bar"></span>'.repeat(13)}</div>
    <p class="rec-time">0:00</p>
    <p class="rec-hint">Grabando…</p>
    <button class="btn primario rec-stop" id="rec-stop">${ico('square')}Detener y guardar</button>
  </div></div>`);
  document.body.append(recOverlay);
  recOverlay.querySelector('#rec-stop').onclick = detenerGrabacion;
  recOverlay.querySelector('#rec-cancel').onclick = cancelarGrabacion;
  recOverlay.querySelector('#rec-stop').focus();
  const t = recOverlay.querySelector('.rec-time');
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  medirNivel();
}

function medirNivel() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser(); analyser.fftSize = 64;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const bars = [...recOverlay.querySelectorAll('.rec-bar')];
    const tick = () => {
      analyser.getByteFrequencyData(data);
      bars.forEach((b, i) => { b.style.height = `${6 + (data[i + 2] || 0) / 255 * 46}px`; });
      rafId = requestAnimationFrame(tick);
    };
    tick();
  } catch {}
}

function limpiarGrabacion() {
  clearInterval(recTimer); cancelAnimationFrame(rafId);
  recOverlay?.remove(); recOverlay = null;
  stream?.getTracks().forEach(t => t.stop());
  stream = null; analyser = null;
}

function cancelarGrabacion() {
  if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); }
  rec = null; limpiarGrabacion(); snack('Grabación cancelada');
}

function detenerGrabacion() {
  if (!rec) return limpiarGrabacion();
  const dur = Date.now() - recStart;
  rec.onstop = async () => {
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    limpiarGrabacion(); rec = null;
    if (dur < 700) return snack('Grabación muy corta. Habla antes de detenerla.');
    const e = agregarEntrada({ tipo: 'audio', estado: 'procesando' });
    await putAudio(e.id, blob);
    transcribir(e, blob);
  };
  rec.stop();
}

/* Gemini no acepta el contenedor webm de MediaRecorder.
   Convertimos a WAV mono 16 kHz en el dispositivo: formato aceptado y mucho más ligero. */
async function aWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  const rendered = await off.startRendering();
  ctx.close();

  const pcm = rendered.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const txt = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); txt(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  txt(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    out.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

async function transcribir(e, blob) {
  try {
    let envio = blob, mime = (blob.type || '').split(';')[0] || 'audio/webm';
    try { envio = await aWav(blob); mime = 'audio/wav'; }
    catch (err) { console.warn('No se pudo convertir a WAV, se envía el original:', err.message || err); }

    if (envio.size > 3.8 * 1024 * 1024) throw new Error('La nota es demasiado larga para transcribirla de una vez. Grábala en partes más cortas.');

    const b64 = await blobB64(envio);
    const { texto } = await apiIA('/api/transcribir', { audio: b64, mime });
    if (!texto) throw new Error('vacío');
    e.contenido = texto; e.transcripcionRaw = texto; e.estado = 'listo';
  } catch (err) {
    e.estado = 'error';
    e.errorIA = String(err.message || err);
    console.warn('Error de transcripción:', err.message || err);
  }
  save(); if (vista === 'hoy') render();
}

const blobB64 = (blob) => new Promise(res => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1]);
  fr.readAsDataURL(blob);
});

/* ---------------- cierre y generación ---------------- */
function confirmarCierre() {
  const d = dia(fechaVista);
  if (!d.entradas.length) return snack('Captura al menos una entrada para cerrar el día.');
  sheet(`<h2>Cerrar el día</h2>
    <p class="desc">
      Se dejarán de aceptar entradas y se generará la bitácora con las ${d.entradas.length} entradas capturadas.</p>
    <div class="sheet-actions"><button class="btn fantasma" data-a="cancel">Cancelar</button><button class="btn primario" data-a="ok">Cerrar día</button></div>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="ok"]').onclick = () => { close(); cerrarDia(d); };
    } });
}

async function cerrarDia(d) {
  d.estado = 'generado'; d.cerradoEn = new Date().toISOString();
  if (!d.entradas.length) { d.bitacora = null; save(); render(); return snack('Día cerrado sin entradas.'); }
  save();
  await generar(d);
  nav('bitacora', d.fecha);
}

async function generar(d) {
  const listo = cargando('Generando la bitácora…');
  const entradas = d.entradas.filter(e => e.contenido).map(e => ({ id: e.id, hora: e.hora, texto: e.contenido }));
  try {
    const j = await apiIA('/api/generar', { area: S.area.nombre, fecha: d.fecha, entradas });
    d.bitacora = {
      actividades: (j.actividades || []).map(a => ({ id: uid(), titulo: a.titulo || '', descripcion: a.descripcion || '', entradasRef: a.entradas_ref || [] })),
      conclusion: j.conclusion || '',
      entidadesDetectadas: j.entidades_detectadas || [],
      generadoEn: new Date().toISOString()
    };
  } catch (err) {
    d.bitacora = {
      actividades: entradas.map(e => ({ id: uid(), titulo: e.texto.slice(0, 48), descripcion: e.texto, entradasRef: [e.id] })),
      conclusion: '',
      entidadesDetectadas: [],
      generadoEn: new Date().toISOString(),
      sinIA: true,
      errorIA: String(err.message || err)
    };
    snack('No se pudo generar con IA. Se armó un borrador con tus entradas: edítalo antes de exportar.');
    console.warn('Error de IA:', err.message || err);
  } finally {
    listo();
  }
  save();
}

/* ---------------- pantalla: Bitácora ---------------- */
function vistaBitacora() {
  const d = dia(fechaVista);
  const bar = encabezado(S.area.nombre, fechaLarga(d.fecha), d.estado,
    d.bitacora ? `<button class="iconbtn" id="regen" data-guide="regenerar" title="Regenerar la bitácora con IA" aria-label="Regenerar bitácora">${ico('refresh')}</button>` : '');
  bar.querySelector('#regen')?.addEventListener('click', () => {
    sheet(`<h2>Regenerar bitácora</h2>
      <p class="desc">Se pierden las ediciones que hayas hecho.</p>
      <div class="sheet-actions"><button class="btn fantasma" data-a="cancel">Cancelar</button><button class="btn primario" data-a="ok">Regenerar</button></div>`,
    { onMount: (s, close) => {
        s.querySelector('[data-a="cancel"]').onclick = close;
        s.querySelector('[data-a="ok"]').onclick = async () => { close(); await generar(d); render(); };
      } });
  });

  const page = el('<div class="page"></div>');

  if (!d.bitacora) {
    page.append(el(vacio('Este día se cerró sin entradas, así que no hay bitácora.')));
    return [bar, page];
  }
  d.revisado = true; save();

  const panes = el('<div class="panes dual"></div>');
  const izq = el('<aside class="pane-entradas" data-guide="entradas-capturadas"></aside>');
  izq.append(el('<div class="section-title" style="margin-top:0">Entradas capturadas</div>'));
  const li = el('<div class="entradas"></div>');
  [...d.entradas].reverse().forEach(e => li.append(entradaCard(e, d)));
  izq.append(li);

  const der = el('<section class="pane-actividades"></section>');
  if (d.bitacora.sinIA) {
    const av = el(`<div class="aviso" data-guide="aviso-sin-ia">${ico('alert')}
      <div><strong>Borrador sin IA.</strong> Cada entrada quedó como una actividad tal cual.
      <div class="aviso-detalle">${esc(d.bitacora.errorIA || 'El servicio no respondió.')}</div></div></div>`);
    der.append(av);
  }
  der.append(el('<div class="section-title" style="margin-top:0">Actividades</div>'));
  d.bitacora.actividades.forEach((a, i) => der.append(actCard(a, i, d)));

  const add = el(`<button class="btn contorno full" data-guide="agregar-actividad">${ico('plus')}Agregar actividad</button>`);
  add.onclick = () => {
    d.bitacora.actividades.push({ id: uid(), titulo: 'Nueva actividad', descripcion: '', entradasRef: [] });
    save(); render();
  };
  der.append(add);

  der.append(el('<div class="section-title">Cierre</div>'), bloqueCierre(d));

  const acciones = el(`<div class="btn-row" data-guide="acciones-bitacora">
    <button class="btn primario" id="exp">${ico('file-down')}Exportar PDF</button>
    ${d.estado === 'listo' ? '' : `<button class="btn contorno" id="marcar">${ico('check-circle')}Marcar como listo</button>`}
    <button class="btn fantasma" id="reabrir">${ico('lock-open')}Reabrir día</button>
  </div>`);
  acciones.querySelector('#exp').onclick = () => exportar(d);
  acciones.querySelector('#marcar')?.addEventListener('click', () => { d.estado = 'listo'; d.revisadoEn = new Date().toISOString(); save(); render(); snack('Bitácora marcada como lista'); });
  acciones.querySelector('#reabrir').onclick = () => confirmarReapertura(d);
  der.append(acciones);

  panes.append(izq, der);
  page.append(panes);
  return [bar, page];
}

function confirmarReapertura(d) {
  sheet(`<h2>Reabrir el día</h2>
    <p class="desc">
      Se podrán agregar entradas otra vez. La bitácora que ya generaste se conserva:
      para que incluya lo nuevo, vuelve a cerrar el día y regenera.</p>
    <div class="sheet-actions"><button class="btn fantasma" data-a="cancel">Cancelar</button><button class="btn primario" data-a="ok">Reabrir día</button></div>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="ok"]').onclick = () => {
        close();
        d.estado = 'abierto'; d.cerradoEn = null; save();
        nav('hoy', d.fecha);
        snack('Día reabierto. Puedes seguir capturando.');
      };
    } });
}

function bloqueCierre(d) {
  const hayConclusion = Boolean(d.bitacora.conclusion?.trim()) || d.bitacora.escribiendoCierre;
  const hayActividades = d.bitacora.actividades.length > 0;

  if (!hayConclusion) {
    const caja = el(`<div class="cierre-vacio" data-guide="cierre">
      <p>Esta bitácora no tiene conclusión.</p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn primario" id="gen-cierre" ${hayActividades ? '' : 'disabled'}>${ico('sparkles')}Generar cierre</button>
        <button class="btn contorno" id="esc-cierre">${ico('pencil')}Escribirlo yo</button>
      </div>
    </div>`);
    caja.querySelector('#gen-cierre').onclick = async () => {
      if (!hayActividades) return;
      await generarCierre(d);
      render();
    };
    caja.querySelector('#esc-cierre').onclick = () => {
      d.bitacora.escribiendoCierre = true; d.bitacora.conclusion = ''; save(); render();
      setTimeout(() => {
        const t = document.querySelector('.conclusion .txt');
        if (t) { t.focus(); getSelection().collapse(t, 0); }
      }, 0);
    };
    return caja;
  }

  const con = el(`<div class="conclusion" data-guide="cierre">
    <div class="conclusion-head">
      <h3>Conclusión del día</h3>
      <button class="mini conclusion-del" aria-label="Eliminar conclusión" title="Eliminar conclusión">${ico('trash')}</button>
    </div>
    <p class="txt" contenteditable="true" role="textbox" data-placeholder="Escribe aquí la conclusión del día" aria-label="Conclusión del día">${esc(d.bitacora.conclusion || '')}</p>
  </div>`);
  con.querySelector('.txt').addEventListener('blur', ev => { if (!ev.target.isConnected) return; d.bitacora.conclusion = ev.target.textContent.trim(); save(); });
  con.querySelector('.conclusion-del').onclick = () => {
    d.bitacora.conclusion = ''; d.bitacora.escribiendoCierre = false; save(); render(); snack('Conclusión eliminada');
  };
  return con;
}

async function generarCierre(d) {
  const listo = cargando('Generando el cierre…');
  try {
    const j = await apiIA('/api/cierre', { area: S.area.nombre, fecha: d.fecha, actividades: d.bitacora.actividades });
    if (!j.conclusion) throw new Error('La IA no devolvió conclusión.');
    d.bitacora.conclusion = j.conclusion;
    save(); snack('Cierre generado');
  } catch (err) {
    snack('No se pudo generar el cierre. Escríbelo a mano.');
    console.warn('Error de cierre:', err.message || err);
  } finally {
    listo();
  }
}

function actCard(a, i, d) {
  const c = el(`<article class="act" ${i === 0 ? 'data-guide="actividad"' : ''}>
    <div class="act-head">
      <span class="act-num">${i + 1}</span>
      <h3 class="act-titulo" contenteditable="true" role="textbox" aria-label="Título de la actividad ${i + 1}">${esc(a.titulo)}</h3>
      <div class="act-tools">
        <button class="mini" data-a="up" aria-label="Subir" title="Subir">${ico('arrow-up')}</button>
        <button class="mini" data-a="down" aria-label="Bajar" title="Bajar">${ico('arrow-down')}</button>
        <button class="mini" data-a="del" aria-label="Eliminar actividad" title="Eliminar actividad">${ico('trash')}</button>
      </div>
    </div>
    <p class="act-desc" contenteditable="true" role="textbox" aria-label="Descripción de la actividad ${i + 1}">${esc(a.descripcion)}</p>
  </article>`);

  c.querySelector('.act-titulo').addEventListener('blur', e => { if (!e.target.isConnected) return; a.titulo = e.target.textContent.trim(); save(); });
  c.querySelector('.act-desc').addEventListener('blur', e => { if (!e.target.isConnected) return; a.descripcion = e.target.textContent.trim(); save(); });

  const arr = d.bitacora.actividades;
  const mover = (n) => { const j = i + n; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; save(); render(); };
  c.querySelector('[data-a="up"]').onclick = () => mover(-1);
  c.querySelector('[data-a="down"]').onclick = () => mover(1);
  c.querySelector('[data-a="del"]').onclick = () => { arr.splice(i, 1); save(); render(); snack('Actividad eliminada'); };

  const audios = (a.entradasRef || []).map(id => d.entradas.find(e => e.id === id)).filter(e => e && e.tipo === 'audio');
  if (audios.length) {
    const box = el('<div class="act-audios"></div>');
    audios.forEach(e => {
      const b = el(`<button class="audio-pill">${ico('play')}Audio ${esc(e.hora)}</button>`);
      b.onclick = () => reproducir(e.id);
      box.append(b);
    });
    c.append(box);
  }
  return c;
}

/* ---------------- pantalla: Historial ---------------- */
function vistaHistorial() {
  const bar = encabezado('Historial', `Área de ${S.area.nombre}`);
  const page = el('<div class="page"></div>');
  const tabs = el(`<div class="tabs" role="tablist" data-guide="pestanas">
    <button role="tab" data-tab="dias" aria-selected="${tabHistorial === 'dias'}">Por día</button>
    <button role="tab" data-tab="semanas" aria-selected="${tabHistorial === 'semanas'}">Por semana</button>
  </div>`);
  tabs.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tabHistorial = b.dataset.tab; render(); });
  page.append(tabs);
  page.append(tabHistorial === 'dias' ? historialDias() : historialSemanas());
  return [bar, page];
}

const diasCerrados = () => Object.values(S.dias)
  .filter(d => d.estado !== 'abierto')
  .sort((a, b) => b.fecha.localeCompare(a.fecha));

function historialSemanas() {
  const cont = el('<div></div>');
  const porSemana = new Map();
  diasCerrados().forEach(d => {
    const k = lunesDe(d.fecha);
    if (!porSemana.has(k)) porSemana.set(k, []);
    porSemana.get(k).push(d);
  });

  if (!porSemana.size) {
    cont.append(el(vacio('Aquí no hay nada todavía. Las semanas aparecerán conforme cierres los días.')));
    return cont;
  }

  [...porSemana.keys()].sort((a, b) => b.localeCompare(a)).forEach((lunes, idx) => {
    const dias = porSemana.get(lunes).slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
    const conBitacora = dias.filter(d => d.bitacora?.actividades.length);
    const acts = conBitacora.reduce((n, d) => n + d.bitacora.actividades.length, 0);
    const card = el(`<div class="semana" ${idx === 0 ? 'data-guide="semana"' : ''}>
      <div class="semana-head">
        <div>
          <div class="semana-rango">${esc(rangoSemana(lunes))}</div>
          <div class="dia-meta">${dias.length} día${dias.length === 1 ? '' : 's'} · ${acts} actividad${acts === 1 ? '' : 'es'}</div>
        </div>
        <button class="btn primario semana-pdf" ${conBitacora.length ? '' : 'disabled'}>${ico('file-down')}PDF de la semana</button>
      </div>
      <div class="semana-dias"></div>
    </div>`);
    card.querySelector('.semana-pdf').onclick = () => exportarSemana(lunes, conBitacora);
    const lista = card.querySelector('.semana-dias');
    dias.forEach(d => {
      const n = d.bitacora?.actividades.length || 0;
      const chip = el(`<button class="semana-dia"><span>${esc(fechaCorta(d.fecha).split(' ').slice(0, 2).join(' '))}</span><span class="semana-dia-n">${n}</span></button>`);
      chip.onclick = () => nav('bitacora', d.fecha);
      lista.append(chip);
    });
    cont.append(card);
  });
  return cont;
}

function historialDias() {
  const wrap = el('<div></div>');
  const buscador = el(`<div class="search" data-guide="buscador">${ico('search')}<input class="input" id="q" type="search" placeholder="Buscar en las bitácoras" aria-label="Buscar en las bitácoras"></div>`);
  const cont = el('<div id="lista-dias"></div>');
  wrap.append(buscador, cont);

  const pintar = (q = '') => {
    cont.innerHTML = '';
    const dias = diasCerrados().filter(d => !q || JSON.stringify(d).toLowerCase().includes(q.toLowerCase()));
    if (!dias.length) {
      cont.append(el(vacio(q
        ? 'Ningún día coincide con la búsqueda.'
        : 'Aquí no hay nada todavía. Los días aparecerán aquí al cerrar el primero.')));
      return;
    }
    let mesActual = '';
    dias.forEach((d, idx) => {
      const [y, m] = d.fecha.split('-');
      const etiqueta = `${MESES[+m - 1]} ${y}`;
      if (etiqueta !== mesActual) { mesActual = etiqueta; cont.append(el(`<div class="mes">${esc(etiqueta)}</div>`)); }
      const n = d.bitacora?.actividades.length || 0;
      const row = el(`<button class="dia-row" ${idx === 0 ? 'data-guide="dia"' : ''}>
        <div style="flex:1;min-width:0">
          <div class="dia-fecha">${esc(fechaCorta(d.fecha))}</div>
          <div class="dia-meta">${n} actividad${n === 1 ? '' : 'es'} · ${d.entradas.length} entrada${d.entradas.length === 1 ? '' : 's'}</div>
        </div>
        <span class="chip-estado" data-estado="${d.estado}">${d.estado}</span>
      </button>`);
      row.onclick = () => nav('bitacora', d.fecha);
      cont.append(row);
    });
  };
  pintar();
  buscador.querySelector('#q').addEventListener('input', e => pintar(e.target.value));
  return wrap;
}

/* ---------------- pantalla: Perfil ---------------- */
function vistaPerfil() {
  const bar = encabezado('Perfil', `Hola, ${YO.nombre.split(' ')[0]}`);
  const guardados = Object.values(S.dias).filter(d => !diaVacio(d)).length;
  const page = el(`<div class="page"><div style="max-width:640px">
    <div class="section-title">Área</div>
    <div class="card">
      <div class="campo" data-guide="perfil-area">
        <label for="area">Nombre del área</label>
        <input class="input" id="area" value="${esc(S.area.nombre)}" autocomplete="off" maxlength="60">
        <span class="ayuda">Aparece en cada pantalla y en el PDF.</span>
      </div>
    </div>
    <div class="section-title">Tu cuenta</div>
    <div class="card" data-guide="perfil-cuenta">
      <div class="campo">
        <label for="nombre">Tu nombre</label>
        <input class="input" id="nombre" value="${esc(YO.nombre)}" autocomplete="name" maxlength="120">
        <span class="ayuda">Se guarda con cada entrada; no aparece en el PDF por actividad.</span>
      </div>
      <div class="campo">
        <label for="correo">Correo</label>
        <input class="input" id="correo" value="${esc(YO.email)}" readonly>
        <span class="ayuda">Con él entras a la app. Solo un administrador puede cambiarlo.</span>
      </div>
    </div>
    <div class="section-title">Datos</div>
    <div class="card dato" data-guide="perfil-datos">
      <span class="dato-label">Días guardados</span>
      <span class="dato-valor">${guardados} en tu cuenta</span>
    </div>
    <p class="firma">Diseñarte México · Marketing e Innovación Digital</p>
  </div>
  </div>`);

  const guardarCampo = async (campo, input, aviso) => {
    const valor = input.value.trim();
    if (valor === YO[campo]) return;
    if (valor.length < (campo === 'nombre' ? 2 : 1)) { input.value = YO[campo]; return snack(campo === 'nombre' ? 'Escribe tu nombre.' : 'Escribe el nombre del área.'); }
    const listo = cargando('Guardando…');
    try {
      const { usuario } = await api('/api/cuenta', 'PATCH', { [campo]: valor });
      recordarUsuario(usuario);
      render(); snack(aviso);
    } catch (e) {
      if (e.status === 401) return sesionVencida();
      input.value = YO[campo]; snack(e.message);
    } finally { listo(); }
  };
  page.querySelector('#area').onchange = e => guardarCampo('area', e.target, 'Área guardada');
  page.querySelector('#nombre').onchange = e => guardarCampo('nombre', e.target, 'Nombre guardado');
  return [bar, page];
}

/* ---------------- pantalla: Usuarios (solo admin) ---------------- */
let usuariosLista = null, usuariosError = '';

async function cargarUsuarios() {
  const listo = cargando('Cargando usuarios…');
  try { usuariosLista = (await api('/api/usuarios')).usuarios; usuariosError = ''; }
  catch (e) {
    if (e.status === 401) return sesionVencida();
    usuariosLista = []; usuariosError = e.message;
  } finally { listo(); }
  if (vista === 'usuarios') { render(); guiaAlEntrar(); }
}

const fechaHora = (iso) => iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'nunca';

function vistaUsuarios() {
  const bar = encabezado('Usuarios', 'Panel de administración', null,
    `<button class="btn primario" id="nuevo-usuario" data-guide="nuevo-usuario" aria-label="Nuevo usuario">${ico('user-plus')}<span class="solo-ancho">Nuevo usuario</span></button>`);
  bar.querySelector('#nuevo-usuario').onclick = () => formUsuario();
  const page = el('<div class="page"></div>');
  if (!usuariosLista) return [bar, page];

  if (usuariosError) {
    page.append(el(`<div class="aviso">${ico('alert')}<div><strong>No se pudo cargar la lista.</strong><div class="aviso-detalle">${esc(usuariosError)}</div></div></div>`));
    const b = el(`<button class="btn contorno">${ico('refresh')}Reintentar</button>`);
    b.onclick = () => cargarUsuarios();
    page.append(b);
    return [bar, page];
  }

  const activos = usuariosLista.filter(u => u.activo).length;
  page.append(el(`<div class="section-title">${usuariosLista.length} cuenta${usuariosLista.length === 1 ? '' : 's'} · ${activos} activa${activos === 1 ? '' : 's'}</div>`));
  const lista = el('<div class="usuarios"></div>');
  usuariosLista.forEach((u, i) => {
    const propio = u.id === YO.id;
    const c = el(`<article class="usuario ${u.activo ? '' : 'inactivo'}" ${i === 0 ? 'data-guide="usuario"' : ''}>
      <div class="avatar">${esc(u.nombre.trim()[0]?.toUpperCase() || '?')}</div>
      <div class="usuario-body">
        <div class="usuario-nombre">${esc(u.nombre)}${propio ? ' <span class="usuario-tu">(tú)</span>' : ''}
          ${u.rol === 'admin' ? '<span class="chip-estado" data-estado="admin">Admin</span>' : ''}
          ${u.activo ? '' : '<span class="chip-estado" data-estado="inactivo">Desactivado</span>'}
        </div>
        <div class="usuario-meta">${esc(u.email)}</div>
        <div class="usuario-meta">Área de ${esc(u.area)} · ${u.dias} día${u.dias === 1 ? '' : 's'} cerrado${u.dias === 1 ? '' : 's'} · Último acceso: ${esc(fechaHora(u.ultimoAcceso))}</div>
        ${u.debeCambiar && u.activo ? '<div class="usuario-aviso">Aún no cambia su contraseña temporal</div>' : ''}
      </div>
      <button class="mini" aria-label="Opciones de ${esc(u.nombre)}" title="Editar, contraseña, desactivar o eliminar">${ico('ellipsis-vertical')}</button>
    </article>`);
    c.querySelector('.mini').onclick = () => menuUsuario(u);
    lista.append(c);
  });
  page.append(lista);
  return [bar, page];
}

function menuUsuario(u) {
  const propio = u.id === YO.id;
  sheet(`<h2>${esc(u.nombre)}</h2>
    <p class="desc" style="margin-bottom:8px">${esc(u.email)}</p>
    <button class="list-opt" data-a="editar">${ico('pencil')}Editar datos</button>
    ${propio ? '' : `<button class="list-opt" data-a="pass">${ico('key')}Restablecer contraseña</button>
    <button class="list-opt" data-a="activo">${ico(u.activo ? 'user-x' : 'user-check')}${u.activo ? 'Desactivar cuenta' : 'Activar cuenta'}</button>
    <button class="list-opt peligro" data-a="borrar">${ico('trash')}Eliminar cuenta</button>`}`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="editar"]').onclick = () => { close(); formUsuario(u); };
      s.querySelector('[data-a="pass"]')?.addEventListener('click', () => { close(); restablecerPassword(u); });
      s.querySelector('[data-a="activo"]')?.addEventListener('click', () => { close(); cambiarActivo(u); });
      s.querySelector('[data-a="borrar"]')?.addEventListener('click', () => { close(); eliminarUsuario(u); });
    } });
}

/* Contraseña temporal legible: sin 0/O ni 1/l/I. */
function passwordTemporal() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint32Array(10))].map(n => abc[n % abc.length]).join('');
}

/* Ejecuta una acción de admin con pantalla de carga; si falla, muestra el error. */
async function accionAdmin(mensaje, fn) {
  const listo = cargando(mensaje);
  try { return await fn(); }
  catch (e) { if (e.status === 401) sesionVencida(); else snack(e.message); return null; }
  finally { listo(); }
}

const actualizarEnLista = (u) => {
  const i = usuariosLista.findIndex(x => x.id === u.id);
  if (i >= 0) usuariosLista[i] = { ...usuariosLista[i], ...u }; else usuariosLista.push(u);
  if (u.id === YO.id) recordarUsuario({ ...YO, nombre: u.nombre, email: u.email, area: u.area, rol: u.rol });
  if (vista === 'usuarios') render();
};

function formUsuario(u = null) {
  const nuevo = !u;
  const propio = u?.id === YO.id;
  sheet(`<h2>${nuevo ? 'Nuevo usuario' : 'Editar usuario'}</h2>
    <form class="form-sheet" novalidate>
      ${campoHTML('nombre', 'Nombre', { valor: u?.nombre, auto: 'off' })}
      ${campoHTML('email', 'Correo', { tipo: 'email', valor: u?.email, auto: 'off', ayuda: 'Con este correo entrará a la app.' })}
      ${campoHTML('area', 'Área', { valor: u?.area ?? S.area.nombre, auto: 'off', ayuda: 'Aparece en sus pantallas y en sus PDF.' })}
      <div class="campo">
        <label for="f-rol">Rol</label>
        <select class="input" id="f-rol" name="rol" ${propio ? 'disabled' : ''}>
          <option value="usuario" ${u?.rol !== 'admin' ? 'selected' : ''}>Usuario: captura sus bitácoras</option>
          <option value="admin" ${u?.rol === 'admin' ? 'selected' : ''}>Administrador: además administra usuarios</option>
        </select>
        ${propio ? '<span class="ayuda">No puedes cambiar tu propio rol.</span>' : ''}
      </div>
      ${nuevo ? `<div class="campo">
        <label for="f-password">Contraseña temporal</label>
        <div class="campo-fila">
          <input class="input" id="f-password" name="password" value="${passwordTemporal()}" autocomplete="off" spellcheck="false">
          <button class="iconbtn" type="button" data-a="gen" title="Generar otra" aria-label="Generar otra contraseña">${ico('refresh')}</button>
        </div>
        <span class="ayuda">Mínimo ${PASSWORD_MIN} caracteres. Al entrar por primera vez, la app le pedirá crear la suya.</span>
      </div>` : ''}
      <div class="aviso-form" role="alert" hidden></div>
      <div class="sheet-actions"><button class="btn fantasma" type="button" data-a="cancel">Cancelar</button>
        <button class="btn primario" type="submit">${nuevo ? 'Crear usuario' : 'Guardar'}</button></div>
    </form>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="gen"]')?.addEventListener('click', () => { s.querySelector('#f-password').value = passwordTemporal(); });
      enviarForm(s.querySelector('form'), nuevo ? 'Creando usuario…' : 'Guardando…', async (f) => {
        exigir(f, { nombre: 'Escribe el nombre.', email: 'Escribe el correo.', area: 'Escribe el área.' });
        if (nuevo) {
          if ((f.password || '').length < PASSWORD_MIN) throw new Error(`La contraseña temporal debe tener al menos ${PASSWORD_MIN} caracteres.`);
          const { usuario } = await api('/api/usuarios', 'POST', f);
          close(); actualizarEnLista(usuario);
          mostrarCredenciales('Usuario creado', usuario, f.password);
        } else {
          const { usuario } = await api('/api/usuarios', 'PATCH', { id: u.id, nombre: f.nombre, email: f.email, area: f.area, ...(propio ? {} : { rol: f.rol }) });
          close(); actualizarEnLista(usuario); snack('Usuario guardado');
        }
      });
    } });
}

function restablecerPassword(u) {
  sheet(`<h2>Restablecer contraseña</h2>
    <p class="desc">Se genera una contraseña temporal para ${esc(u.nombre)} y se cierran sus sesiones abiertas. Al entrar, la app le pedirá crear una nueva.</p>
    <div class="sheet-actions"><button class="btn fantasma" data-a="cancel">Cancelar</button><button class="btn primario" data-a="ok">Restablecer</button></div>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="ok"]').onclick = async () => {
        close();
        const pw = passwordTemporal();
        const r = await accionAdmin('Guardando la contraseña…', () => api('/api/usuarios', 'PATCH', { id: u.id, password: pw }));
        if (r) { actualizarEnLista(r.usuario); mostrarCredenciales('Contraseña restablecida', r.usuario, pw); }
      };
    } });
}

function cambiarActivo(u) {
  const activar = !u.activo;
  sheet(`<h2>${activar ? 'Activar cuenta' : 'Desactivar cuenta'}</h2>
    <p class="desc">${activar
      ? `${esc(u.nombre)} podrá volver a entrar con su correo y contraseña.`
      : `${esc(u.nombre)} ya no podrá entrar y se cerrarán sus sesiones abiertas. Sus bitácoras se conservan y puedes reactivarla cuando quieras.`}</p>
    <div class="sheet-actions"><button class="btn fantasma" data-a="cancel">Cancelar</button><button class="btn ${activar ? 'primario' : 'destructivo'}" data-a="ok">${activar ? 'Activar' : 'Desactivar'}</button></div>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="ok"]').onclick = async () => {
        close();
        const r = await accionAdmin('Guardando…', () => api('/api/usuarios', 'PATCH', { id: u.id, activo: activar }));
        if (r) { actualizarEnLista(r.usuario); snack(activar ? 'Cuenta activada' : 'Cuenta desactivada'); }
      };
    } });
}

function eliminarUsuario(u) {
  sheet(`<h2>Eliminar cuenta</h2>
    <p class="desc">Se borran la cuenta de ${esc(u.nombre)} y sus ${u.dias} día${u.dias === 1 ? '' : 's'} de bitácora guardados en el servidor. No se puede deshacer.</p>
    <p class="desc" style="margin-top:8px">Si solo quieres quitarle el acceso, mejor desactiva la cuenta.</p>
    <div class="sheet-actions"><button class="btn fantasma" data-a="cancel">Cancelar</button><button class="btn destructivo" data-a="ok">Eliminar</button></div>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="ok"]').onclick = async () => {
        close();
        const r = await accionAdmin('Eliminando…', () => api(`/api/usuarios?id=${u.id}`, 'DELETE'));
        if (r) { usuariosLista = usuariosLista.filter(x => x.id !== u.id); render(); snack('Cuenta eliminada'); }
      };
    } });
}

function mostrarCredenciales(titulo, u, pw) {
  const texto = `Bitácora · Diseñarte México\n${location.origin}\nCorreo: ${u.email}\nContraseña temporal: ${pw}`;
  sheet(`<h2>${esc(titulo)}</h2>
    <p class="desc">Comparte estos datos con ${esc(u.nombre)}. Al entrar, la app le pedirá crear su propia contraseña. Esta contraseña no se vuelve a mostrar.</p>
    <dl class="credenciales">
      <dt>Correo</dt><dd>${esc(u.email)}</dd>
      <dt>Contraseña temporal</dt><dd class="mono">${esc(pw)}</dd>
    </dl>
    <div class="sheet-actions"><button class="btn contorno" data-a="copiar">${ico('copy')}Copiar datos</button><button class="btn primario" data-a="ok">Listo</button></div>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="ok"]').onclick = close;
      s.querySelector('[data-a="copiar"]').onclick = async () => {
        try { await navigator.clipboard.writeText(texto); snack('Datos copiados'); }
        catch { snack('No se pudo copiar. Selecciona el texto y cópialo a mano.'); }
      };
    } });
}

/* ---------------- formularios ---------------- */
function campoHTML(nombre, etiqueta, { tipo = 'text', valor = '', auto = 'off', ayuda = '', autofocus = false } = {}) {
  return `<div class="campo">
    <label for="f-${nombre}">${esc(etiqueta)}</label>
    <input class="input" id="f-${nombre}" name="${nombre}" type="${tipo}" value="${esc(valor ?? '')}" autocomplete="${auto}" ${autofocus ? 'autofocus' : ''} ${tipo === 'email' ? 'inputmode="email" autocapitalize="off" spellcheck="false"' : ''}>
    ${ayuda ? `<span class="ayuda">${esc(ayuda)}</span>` : ''}
  </div>`;
}

function exigir(f, mensajes) {
  for (const [k, m] of Object.entries(mensajes)) if (!String(f[k] || '').trim()) throw new Error(m);
}

/* Envía un formulario con pantalla de carga; los errores salen en su .aviso-form. */
function enviarForm(form, mensaje, fn) {
  const aviso = form.querySelector('.aviso-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    aviso.hidden = true;
    const datos = Object.fromEntries(new FormData(form));
    const listo = cargando(mensaje);
    try { await fn(datos); }
    catch (e) {
      if (e.status === 401 && YO) { listo(); return sesionVencida(); }
      aviso.textContent = e.message; aviso.hidden = false;
    } finally { listo(); }
  });
}

/* ---------------- acceso: entrar, configuración inicial y contraseña ---------------- */
const MARCA = (img, tam) => `<div class="marca"><img src="icons/${img}" alt="" width="${tam}" height="${tam}">
  <div><div class="marca-nombre">Bitácora</div><div class="marca-sub">Diseñarte México</div></div></div>`;

/* Escritorio: panel morado con la marca a la izquierda y la tarjeta sobre la textura.
   Celular: la marca a color arriba de la tarjeta. */
function pantallaAcceso(titulo, descripcion, cuerpo) {
  cerrarGuia(); cerrarMenu();
  document.querySelectorAll('#sheet-root > *, #snackbar-root > *').forEach(n => n.remove());
  $('#app').hidden = true;
  const a = $('#acceso');
  a.hidden = false;
  a.innerHTML = `<main class="acceso">
    <section class="acceso-panel">
      <div class="acceso-panel-centro">
        <div class="acceso-marca-grande">${MARCA('hoja-blanca.svg', 76)}</div>
        <div class="filete acceso-filete"></div>
        <p class="acceso-frase">Registra el día de tu área por voz o por escrito y entrégalo en PDF.</p>
      </div>
      <p class="acceso-web">www.disenartemx.com</p>
    </section>
    <section class="acceso-lado">
      <div class="acceso-col">
        <div class="acceso-marca-movil">${MARCA('hoja.svg', 52)}</div>
        <div class="card acceso-card">
          <h1 class="acceso-titulo">${esc(titulo)}</h1>
          <p class="acceso-desc">${esc(descripcion)}</p>
          ${cuerpo}
        </div>
      </div>
    </section>
  </main>`;
  a.querySelector('[autofocus]')?.focus();
  return a;
}

function pantallaLogin(aviso = '') {
  const a = pantallaAcceso('Iniciar sesión', 'Usa el correo y la contraseña que te dio el administrador.', `
    <form class="form-acceso" novalidate>
      ${campoHTML('email', 'Correo', { tipo: 'email', auto: 'username', autofocus: true })}
      ${campoHTML('password', 'Contraseña', { tipo: 'password', auto: 'current-password' })}
      <div class="aviso-form" role="alert" ${aviso ? '' : 'hidden'}>${esc(aviso)}</div>
      <button class="btn primario full" type="submit">Entrar</button>
    </form>`);
  enviarForm(a.querySelector('form'), 'Entrando…', async (f) => {
    exigir(f, { email: 'Escribe tu correo.', password: 'Escribe tu contraseña.' });
    const { usuario } = await api('/api/sesion', 'POST', { email: f.email, password: f.password });
    await entrar(usuario);
  });
}

function pantallaConfiguracion() {
  const a = pantallaAcceso('Configuración inicial',
    'Crea la cuenta de administrador. Este paso solo aparece una vez, mientras no exista ninguna cuenta.', `
    <form class="form-acceso" novalidate>
      ${campoHTML('nombre', 'Nombre', { auto: 'name', autofocus: true })}
      ${campoHTML('email', 'Correo', { tipo: 'email', auto: 'username' })}
      ${campoHTML('area', 'Área', { valor: 'Dirección', ayuda: 'El área de tus propias bitácoras. Puedes cambiarla después en Perfil.' })}
      ${campoHTML('password', 'Contraseña', { tipo: 'password', auto: 'new-password', ayuda: `Mínimo ${PASSWORD_MIN} caracteres.` })}
      ${campoHTML('confirmacion', 'Confirmar contraseña', { tipo: 'password', auto: 'new-password' })}
      <div class="aviso-form" role="alert" hidden></div>
      <button class="btn primario full" type="submit">Crear cuenta de admin</button>
    </form>`);
  enviarForm(a.querySelector('form'), 'Creando la cuenta…', async (f) => {
    exigir(f, { nombre: 'Escribe tu nombre.', email: 'Escribe tu correo.', area: 'Escribe el área.', password: 'Escribe una contraseña.' });
    if (f.password.length < PASSWORD_MIN) throw new Error(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
    if (f.password !== f.confirmacion) throw new Error('Las contraseñas no coinciden.');
    try {
      const { usuario } = await api('/api/configuracion-inicial', 'POST', f);
      await entrar(usuario);
    } catch (e) {
      // Alguien ya la hizo: pasar al login.
      if (e.status === 409) return pantallaLogin(e.message);
      throw e;
    }
  });
}

/* Primer acceso con contraseña temporal: hay que crear una propia antes de seguir. */
function pantallaPasswordNueva(usuario) {
  const a = pantallaAcceso('Crea tu contraseña',
    `Hola, ${usuario.nombre.split(' ')[0]}. Entraste con una contraseña temporal; crea una propia para continuar.`, `
    <form class="form-acceso" novalidate>
      <input type="email" name="usuario" value="${esc(usuario.email)}" autocomplete="username" hidden>
      ${campoHTML('nueva', 'Contraseña nueva', { tipo: 'password', auto: 'new-password', autofocus: true, ayuda: `Mínimo ${PASSWORD_MIN} caracteres.` })}
      ${campoHTML('confirmacion', 'Confirmar contraseña', { tipo: 'password', auto: 'new-password' })}
      <div class="aviso-form" role="alert" hidden></div>
      <button class="btn primario full" type="submit">Guardar contraseña</button>
      <button class="btn fantasma full" type="button" data-a="salir">Salir</button>
    </form>`);
  a.querySelector('[data-a="salir"]').onclick = () => cerrarSesion();
  enviarForm(a.querySelector('form'), 'Guardando la contraseña…', async (f) => {
    if ((f.nueva || '').length < PASSWORD_MIN) throw new Error(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
    if (f.nueva !== f.confirmacion) throw new Error('Las contraseñas no coinciden.');
    const { usuario: act } = await api('/api/cuenta', 'POST', { nueva: f.nueva });
    await entrar(act);
    snack('Contraseña guardada');
  });
}

function pantallaSinServidor(mensaje) {
  const a = pantallaAcceso('No se pudo conectar', mensaje, `
    <button class="btn primario full" type="button" data-a="otra">${ico('refresh')}Intentar de nuevo</button>`);
  a.querySelector('[data-a="otra"]').onclick = () => arranque();
}

/* Cambio de contraseña con la sesión abierta (desde el menú). */
function cambiarPassword() {
  sheet(`<h2>Cambiar contraseña</h2>
    <form class="form-sheet" novalidate>
      <input type="email" name="usuario" value="${esc(YO.email)}" autocomplete="username" hidden>
      ${campoHTML('actual', 'Contraseña actual', { tipo: 'password', auto: 'current-password' })}
      ${campoHTML('nueva', 'Contraseña nueva', { tipo: 'password', auto: 'new-password', ayuda: `Mínimo ${PASSWORD_MIN} caracteres. Se cerrará tu sesión en los demás dispositivos.` })}
      ${campoHTML('confirmacion', 'Confirmar contraseña nueva', { tipo: 'password', auto: 'new-password' })}
      <div class="aviso-form" role="alert" hidden></div>
      <div class="sheet-actions"><button class="btn fantasma" type="button" data-a="cancel">Cancelar</button><button class="btn primario" type="submit">Guardar</button></div>
    </form>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      enviarForm(s.querySelector('form'), 'Guardando la contraseña…', async (f) => {
        exigir(f, { actual: 'Escribe tu contraseña actual.' });
        if ((f.nueva || '').length < PASSWORD_MIN) throw new Error(`La contraseña nueva debe tener al menos ${PASSWORD_MIN} caracteres.`);
        if (f.nueva !== f.confirmacion) throw new Error('Las contraseñas nuevas no coinciden.');
        await api('/api/cuenta', 'POST', { actual: f.actual, nueva: f.nueva });
        close(); snack('Contraseña cambiada');
      });
    } });
}

/* ---------------- sesión ---------------- */
function recordarUsuario(u) {
  YO = u;
  S.area.nombre = u.area;
  S.usuario = { id: u.id, nombre: u.nombre };
  try { localStorage.setItem(KEY_SESION, JSON.stringify(u)); } catch {}
  pintarMenu();
}

async function entrar(usuario, { sinConexion = false } = {}) {
  if (usuario.debeCambiar) return pantallaPasswordNueva(usuario);
  YO = usuario;
  cargarLocal();
  recordarUsuario(usuario);
  estadoSync = sinConexion ? 'sin-conexion' : 'ok';
  // Antes de mostrar la app se bajan las bitácoras de la cuenta (dentro de "Entrando…").
  const bajo = sinConexion ? false : await sincronizar({ bajar: true });
  if (YO !== usuario) return;   // la sesión venció mientras tanto
  if (bajo) pasarDatosViejos();

  $('#acceso').hidden = true; $('#acceso').innerHTML = '';
  $('#app').hidden = false;
  nav('hoy', hoyISO());
  if (sinConexion) snack('Sin conexión con el servidor. Puedes capturar; tus cambios se subirán al volver el internet.');
}

/* Las bitácoras que había en este dispositivo antes de las cuentas pasan a la primera cuenta que entra. */
function pasarDatosViejos() {
  let viejo = null;
  try { viejo = JSON.parse(localStorage.getItem(KEY_VIEJA)); } catch {}
  const dias = Object.values(viejo?.dias || {}).filter(d => d?.fecha && !diaVacio(d));
  let n = 0;
  dias.forEach(d => {
    if (S.dias[d.fecha]) return;
    d.entradas.forEach(e => { if (e.usuarioId === 'u1') { e.usuarioId = YO.id; e.usuarioNombre = viejo.usuario?.nombre === 'Tú' || !viejo.usuario?.nombre ? YO.nombre : viejo.usuario.nombre; } });
    S.dias[d.fecha] = d; n++;
  });
  try {
    if (viejo) { localStorage.setItem(`${KEY_VIEJA}.respaldo`, JSON.stringify(viejo)); localStorage.removeItem(KEY_VIEJA); }
  } catch {}
  if (n) { save(); snack(n === 1 ? 'Se pasó a tu cuenta 1 día que estaba guardado en este dispositivo.' : `Se pasaron a tu cuenta ${n} días que estaban guardados en este dispositivo.`); }
}

/* Limpia la sesión local. Si quedó algo sin subir, se conserva en el dispositivo para la próxima vez. */
function olvidarSesion() {
  clearTimeout(syncTimer);
  try {
    localStorage.removeItem(KEY_SESION);
    if (YO && !pendientes.size) localStorage.removeItem(keyUsuario(YO.id));
  } catch {}
  YO = null;
  S = { area: { nombre: '' }, usuario: { id: '', nombre: '' }, dias: {} };
  pendientes = new Set(); enServidor = new Set(); firmas = {};
  usuariosLista = null;
  guiaVista.clear();
  if (rec) cancelarGrabacion();
}

function sesionVencida() {
  if (!YO) return;
  guardarLocal();
  olvidarSesion();
  pantallaLogin('Tu sesión terminó. Vuelve a entrar.');
}

async function cerrarSesion() {
  const listo = cargando('Cerrando sesión…');
  try { await Promise.race([api('/api/sesion', 'DELETE'), espera(3000)]); } catch {}
  olvidarSesion();
  pantallaLogin();
  listo();
}

async function salir() {
  cerrarMenu();
  if (pendientes.size) {
    const listo = cargando('Sincronizando…');
    await sincronizar().catch(() => {});
    listo();
  }
  if (!pendientes.size) return cerrarSesion();
  const n = pendientes.size;
  sheet(`<h2>Hay cambios sin subir</h2>
    <p class="desc">${n} día${n === 1 ? '' : 's'} con cambios no se ha${n === 1 ? '' : 'n'} subido al servidor porque no hay conexión.
    Si sales ahora, se quedan en este dispositivo y se suben la próxima vez que entres aquí con tu cuenta.</p>
    <div class="sheet-actions"><button class="btn fantasma" data-a="cancel">Cancelar</button><button class="btn primario" data-a="ok">Salir de todos modos</button></div>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="ok"]').onclick = () => { close(); cerrarSesion(); };
    } });
}

/* Al abrir: ¿falta la configuración inicial?, ¿hay sesión? Sin servidor, abre con el último usuario. */
async function arranque() {
  const listo = cargando('Abriendo Bitácora…');
  try {
    let r;
    try { r = await api('/api/sesion'); }
    catch (e) {
      let cache = null;
      try { cache = JSON.parse(localStorage.getItem(KEY_SESION)); } catch {}
      if (cache?.id) return await entrar(cache, { sinConexion: true });
      return pantallaSinServidor(e.message);
    }
    if (r.configurar) return pantallaConfiguracion();
    if (!r.usuario) {
      try { localStorage.removeItem(KEY_SESION); } catch {}
      return pantallaLogin();
    }
    await entrar(r.usuario);
  } finally { listo(); }
}

/* ---------------- PDF ---------------- */
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '');
const nombreArchivo = (d) => `Bitacora_${slug(S.area.nombre)}_${d.fecha}.pdf`;
const nombreArchivoSemana = (lunes) => `Bitacora_${slug(S.area.nombre)}_Semana_${lunes}.pdf`;

/* Poppins también en el PDF. Si no carga, se usa Helvetica. */
let F = 'helvetica';
let fuentesPDF = null;
const aB64 = (buf) => {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
};
async function fuentes(doc) {
  fuentesPDF ??= Promise.all([['Regular', 'normal'], ['SemiBold', 'bold'], ['Italic', 'italic']].map(async ([archivo, estilo]) => {
    const r = await fetch(`fonts/Poppins-${archivo}.ttf`);
    if (!r.ok) throw new Error(`fonts/Poppins-${archivo}.ttf`);
    return [archivo, estilo, aB64(await r.arrayBuffer())];
  })).catch(err => { console.warn('PDF sin Poppins:', err.message || err); fuentesPDF = null; return null; });
  const lista = await fuentesPDF;
  if (!lista) { F = 'helvetica'; return; }
  lista.forEach(([archivo, estilo, b64]) => {
    doc.addFileToVFS(`Poppins-${archivo}.ttf`, b64);
    doc.addFont(`Poppins-${archivo}.ttf`, 'Poppins', estilo);
  });
  F = 'Poppins';
}

/* Filete de marca (turquesa → magenta) en franjas finas, porque jsPDF no dibuja degradados. */
function filetePDF(doc, x, y, w, h) {
  const a = [92, 198, 208], b = [165, 54, 146], n = 80;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    doc.setFillColor(...a.map((c, k) => Math.round(c + (b[k] - c) * t)));
    doc.rect(x + (w / n) * i, y, w / n + .5, h, 'F');
  }
}

async function docNuevo() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  await fuentes(doc);
  filetePDF(doc, 0, 0, doc.internal.pageSize.getWidth(), 6);
  return doc;
}

function encabezadoPDF(doc, titulo, sub) {
  const W = doc.internal.pageSize.getWidth(), M = 56;
  let y = M + 6;
  doc.setFont(F, 'bold'); doc.setFontSize(20); doc.setTextColor(124, 7, 166);
  doc.text(titulo, M, y); y += 22;
  doc.setFont(F, 'normal'); doc.setFontSize(12); doc.setTextColor(75, 72, 83);
  doc.text(sub, M, y); y += 12;
  doc.setDrawColor(228, 225, 232); doc.line(M, y, W - M, y);
  return y + 30;
}

/* Dibuja las actividades y la conclusión de un día. Devuelve la nueva y. */
function pintarDia(doc, d, y, { subtitulo } = {}) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 56;
  const espacio = (n) => { if (y + n > H - 70) { doc.addPage(); y = M; } };

  if (subtitulo) {
    espacio(46);
    doc.setFont(F, 'bold'); doc.setFontSize(13); doc.setTextColor(124, 7, 166);
    doc.text(subtitulo, M, y); y += 8;
    doc.setDrawColor(228, 225, 232); doc.line(M, y, W - M, y); y += 22;
  }

  const acts = d.bitacora?.actividades || [];
  if (!acts.length) {
    espacio(30);
    doc.setFont(F, 'italic'); doc.setFontSize(11); doc.setTextColor(98, 96, 106);
    doc.text('Sin actividades registradas.', M, y); y += 26;
  }

  acts.forEach((a, i) => {
    espacio(70);
    doc.setFont(F, 'bold'); doc.setFontSize(12); doc.setTextColor(29, 27, 34);
    const t = doc.splitTextToSize(`${i + 1}. ${a.titulo}`, W - M * 2);
    doc.text(t, M, y); y += t.length * 16 + 4;
    doc.setFont(F, 'normal'); doc.setFontSize(11); doc.setTextColor(75, 72, 83);
    const p = doc.splitTextToSize(a.descripcion || '', W - M * 2 - 14);
    espacio(p.length * 15);
    doc.text(p, M + 14, y, { lineHeightFactor: 1.35 }); y += p.length * 15 + 20;
  });

  if (d.bitacora?.conclusion) {
    doc.setFont(F, 'normal'); doc.setFontSize(11);
    const p = doc.splitTextToSize(d.bitacora.conclusion, W - M * 2 - 36);
    const h = p.length * 15 + 46;
    espacio(h + 10);
    doc.setFillColor(243, 241, 245); doc.rect(M, y, W - M * 2, h, 'F');
    filetePDF(doc, M, y, W - M * 2, 3);
    doc.setFont(F, 'bold'); doc.setFontSize(9); doc.setTextColor(124, 7, 166);
    doc.text(subtitulo ? 'CIERRE DEL DÍA' : 'CONCLUSIÓN DEL DÍA', M + 18, y + 22);
    doc.setFont(F, 'normal'); doc.setFontSize(11); doc.setTextColor(29, 27, 34);
    doc.text(p, M + 18, y + 40, { lineHeightFactor: 1.35 });
    y += h + 24;
  }
  return y;
}

function pieDePagina(doc, linea) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 56;
  const pags = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pags; i++) {
    doc.setPage(i);
    if (i > 1) filetePDF(doc, 0, 0, W, 6);
    doc.setDrawColor(228, 225, 232); doc.line(M, H - 58, W - M, H - 58);
    doc.setFont(F, 'normal'); doc.setFontSize(8); doc.setTextColor(98, 96, 106);
    doc.text(linea, M, H - 42);
    doc.text('Diseñarte México', M, H - 30);
    doc.text(`${i} / ${pags}`, W - M, H - 30, { align: 'right' });
  }
}

async function construirPDF(d) {
  const doc = await docNuevo();
  const y = encabezadoPDF(doc, 'Bitácora diaria', `${S.area.nombre} · ${fechaLarga(d.fecha)}`);
  pintarDia(doc, d, y);
  const capturaron = [...new Set(d.entradas.map(e => e.usuarioNombre))].join(', ') || '—';
  pieDePagina(doc, `Capturaron: ${capturaron} · ${d.entradas.length} entradas`);
  return doc;
}

async function construirPDFSemana(lunes, dias) {
  const doc = await docNuevo();
  let y = encabezadoPDF(doc, 'Bitácora semanal', `${S.area.nombre} · ${rangoSemana(lunes)}`);
  dias.forEach((d, i) => {
    if (i) { doc.addPage(); y = 56; }
    y = pintarDia(doc, d, y, { subtitulo: fechaCorta(d.fecha) });
  });
  const todas = dias.flatMap(d => d.entradas);
  const capturaron = [...new Set(todas.map(e => e.usuarioNombre))].join(', ') || '—';
  pieDePagina(doc, `${dias.length} días · ${todas.length} entradas · Capturaron: ${capturaron}`);
  return doc;
}

async function exportar(d) {
  if (!window.jspdf) return snack('El generador de PDF aún está cargando. Intenta de nuevo.');
  const listo = cargando('Generando el PDF…');
  try { ofrecerPDF(await construirPDF(d), nombreArchivo(d), 'Exportar bitácora'); }
  finally { listo(); }
}

async function exportarSemana(lunes, dias) {
  if (!window.jspdf) return snack('El generador de PDF aún está cargando. Intenta de nuevo.');
  if (!dias.length) return snack('Esa semana no tiene bitácoras generadas.');
  const listo = cargando('Generando el PDF…');
  try { ofrecerPDF(await construirPDFSemana(lunes, dias), nombreArchivoSemana(lunes), 'Exportar semana'); }
  finally { listo(); }
}

function ofrecerPDF(doc, nombre, titulo) {
  const blob = doc.output('blob');
  const file = new File([blob], nombre, { type: 'application/pdf' });
  const puedeCompartir = navigator.canShare?.({ files: [file] });

  sheet(`<h2>${esc(titulo)}</h2>
    <p class="desc" style="margin-bottom:12px">${esc(nombre)}</p>
    <button class="list-opt" data-a="desc">${ico('download')}Descargar</button>
    ${puedeCompartir ? `<button class="list-opt" data-a="share">${ico('share')}Compartir</button>` : ''}
    <button class="list-opt" data-a="prev">${ico('eye')}Vista previa</button>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="desc"]').onclick = () => { doc.save(nombre); close(); snack('PDF exportado'); };
      s.querySelector('[data-a="prev"]').onclick = () => { window.open(URL.createObjectURL(blob), '_blank'); close(); };
      s.querySelector('[data-a="share"]')?.addEventListener('click', async () => {
        try { await navigator.share({ files: [file], title: nombre }); snack('PDF compartido'); } catch {}
        close();
      });
    } });
}

/* ---------------- asistente de uso ---------------- */
/* Recorre la pantalla actual y señala cada sección marcada con data-guide.
   Paso: { t?: data-guide, m?: está en el menú, si?: () => bool, titulo, texto, lista?: [[etiqueta, texto]], nota? } */
const GUIA_KEY = 'bitacora.asistente';
const asistenteActivo = () => { try { return localStorage.getItem(GUIA_KEY) !== '0'; } catch { return true; } };
function setAsistente(on) { try { localStorage.setItem(GUIA_KEY, on ? '1' : '0'); } catch {} pintarMenu(); }
const guiaVista = new Set();   // pantallas cuya guía ya salió en esta visita
let guiaActual = null;

const PASOS_MENU = () => [
  { titulo: '¡Bienvenido a Bitácora!',
    texto: 'Aquí registras lo que pasa en tu área durante el día, por voz o por escrito. Al cerrar el día, la app arma la bitácora con inteligencia artificial y la exportas en PDF para tu gerente. Este asistente te explica cada pantalla.',
    nota: 'Avanza con "Siguiente" o con las flechas del teclado. "Saltar" cierra la guía de esta pantalla. Si ya no la necesitas, marca la casilla de abajo.' },
  { t: 'menu-boton', titulo: 'Botón de menú',
    texto: 'Toca este botón para abrir el menú. Desde ahí cambias de pantalla y ajustas el asistente. Se cierra con la ×, al tocar fuera o al elegir una opción.' },
  { t: 'menu-secciones', m: true, titulo: 'Secciones', texto: 'Estas son las pantallas de la app:',
    lista: [['Hoy', 'capturas las entradas del día y lo cierras para generar la bitácora.'],
            ['Historial', 'consultas los días cerrados y exportas el PDF de un día o de toda la semana.'],
            ['Perfil', 'cambias el nombre del área y tu nombre.'],
            ...(YO?.rol === 'admin' ? [['Usuarios', 'creas y administras las cuentas de quienes usan la app (solo administradores).']] : [])] },
  { t: 'menu-cuenta', m: true, titulo: 'Cuenta', texto: 'Opciones para usar la app:',
    lista: [['Sincronizar', 'sube tus cambios al servidor y trae lo que hayas capturado en otro dispositivo. También pasa sola.'],
            ['Cambiar contraseña', 'cambia la contraseña con la que entras.'],
            ['Asistente de uso', 'enciende o apaga esta guía. Encendido, aparece al entrar a cada pantalla.'],
            ['Ver guía de esta pantalla', 'muestra la guía de donde estés, aunque el asistente esté apagado.'],
            ...(!$('#instalar').hidden ? [['Instalar como app', 'agrega Bitácora a tu pantalla de inicio para abrirla como cualquier app.']] : [])] },
  { t: 'menu-pie', m: true, titulo: 'Tu cuenta',
    texto: 'Aquí ves tu nombre, tu área y si tus bitácoras ya están guardadas en el servidor. Con Salir cierras tu sesión en este dispositivo.',
    nota: 'Tus bitácoras se guardan en tu cuenta: entra desde otro teléfono o computadora y ahí estarán. Sin internet puedes seguir capturando; se suben solas al volver la conexión. Los audios se quedan en el dispositivo donde los grabaste.' },
  { t: 'ayuda', titulo: 'Ayuda en cualquier momento',
    texto: 'Este botón vuelve a mostrar la guía de la pantalla en la que estés, aunque hayas apagado el asistente.' }
];

const PASOS = {
  hoy: () => [
    ...PASOS_MENU(),
    { t: 'encabezado', titulo: 'El día de hoy', texto: 'Arriba ves la fecha, el área y el estado del día:',
      lista: [['Abierto', 'aceptas entradas nuevas.'], ['Generado', 'ya cerraste el día y la bitácora está lista para revisar.'], ['Listo', 'ya la revisaste y la marcaste como terminada.']] },
    { t: 'boton-grabar', titulo: 'Grabar una nota de voz',
      texto: 'Toca Grabar y cuenta lo que hiciste o lo que pasó. Al terminar, toca "Detener y guardar": la nota se transcribe sola y el audio se conserva. Con la × la descartas.',
      nota: 'En computadora también puedes usar la barra espaciadora para empezar y detener la grabación.' },
    { t: 'boton-escribir', titulo: 'Escribir una entrada', texto: 'Si no puedes hablar, toca el teclado y escribe la entrada a mano.' },
    { t: 'entradas', titulo: 'Entradas del día',
      texto: 'Cada entrada muestra la hora, quién la capturó y el texto. Con el botón de reproducir escuchas el audio; con el de opciones editas el texto o eliminas la entrada.' },
    { t: 'cerrar-dia', titulo: 'Cerrar el día',
      texto: 'Cuando termines la jornada, toca este botón. Se dejan de aceptar entradas y la app genera la bitácora con las actividades y una conclusión.',
      nota: 'Si después necesitas agregar algo, puedes reabrir el día desde la bitácora.' },
    { t: 'ver-bitacora', titulo: 'Ver la bitácora', texto: 'Este día ya está cerrado. Toca aquí para revisar, editar y exportar su bitácora.' }
  ],
  bitacora: () => [
    { titulo: 'Bitácora del día', texto: 'Aquí revisas lo que generó la IA a partir de las entradas. Todo se puede corregir antes de exportar.' },
    { t: 'aviso-sin-ia', titulo: 'Borrador sin IA', texto: 'El servicio de IA no respondió, así que cada entrada quedó como una actividad. Corrígelas o toca Regenerar para intentarlo otra vez.' },
    { t: 'entradas-capturadas', titulo: 'Entradas capturadas', texto: 'A la izquierda tienes las entradas originales del día, para compararlas con las actividades.' },
    { t: 'actividad', titulo: 'Actividad',
      texto: 'Toca el título o la descripción para corregirlos; se guardan al salir del texto. Con las flechas cambias el orden y con el bote la eliminas. Si viene de notas de voz, abajo puedes escuchar los audios.' },
    { t: 'agregar-actividad', titulo: 'Agregar actividad', texto: 'Agrega una actividad que no haya salido en la bitácora.' },
    { t: 'cierre', titulo: 'Conclusión del día', texto: 'Resume la jornada. Puedes generarla con IA, escribirla tú o corregir la que ya existe.' },
    { t: 'acciones-bitacora', titulo: 'Terminar', texto: 'Cuando la bitácora esté bien:',
      lista: [['Exportar PDF', 'la descargas, la compartes o la ves antes de enviarla.'],
              ['Marcar como listo', 'indica que ya la revisaste.'],
              ['Reabrir día', 'vuelve a aceptar entradas; para incluirlas, cierra el día otra vez y regenera.']] },
    { t: 'regenerar', titulo: 'Regenerar', texto: 'Vuelve a generar la bitácora con IA a partir de las entradas. Se pierden las ediciones que hayas hecho.' }
  ],
  historial: () => [
    { titulo: 'Historial', texto: 'Aquí están todos los días que ya cerraste en tu cuenta.' },
    { t: 'pestanas', titulo: 'Por día o por semana', texto: 'Cambia entre la lista de días y el resumen por semana.' },
    { t: 'buscador', titulo: 'Buscar', texto: 'Escribe una palabra para encontrar los días cuya bitácora o entradas la mencionen.' },
    { t: 'dia', titulo: 'Un día cerrado', texto: 'Muestra cuántas actividades y entradas tiene y su estado. Tócalo para abrir su bitácora.' },
    { t: 'semana', titulo: 'Una semana', texto: 'Resume los días cerrados de esa semana. Toca un día para abrirlo o "PDF de la semana" para exportarlos todos en un solo archivo.' },
    { t: 'vacio', titulo: 'Todavía sin días', texto: 'Cuando cierres tu primer día, aparecerá aquí.' }
  ],
  perfil: () => [
    { titulo: 'Perfil', texto: 'Aquí ajustas los datos que aparecen en la bitácora. Los cambios se guardan al salir de cada campo.' },
    { t: 'perfil-area', titulo: 'Nombre del área', texto: 'Aparece en cada pantalla y en el PDF. Cámbialo si capturas para otra área.' },
    { t: 'perfil-cuenta', titulo: 'Tu cuenta', texto: 'Tu nombre se guarda con cada entrada que capturas, para saber quién la registró. El correo es con el que entras; solo un administrador puede cambiarlo.' },
    { t: 'perfil-datos', titulo: 'Datos', texto: 'Cuántos días tienes guardados en tu cuenta.' }
  ],
  usuarios: () => [
    { titulo: 'Usuarios', texto: 'Aquí administras quién puede entrar a Bitácora. Cada persona tiene su cuenta y ve solo sus propias bitácoras.' },
    { t: 'nuevo-usuario', titulo: 'Nuevo usuario',
      texto: 'Crea la cuenta con nombre, correo, área, rol y una contraseña temporal. Al terminar te muestra los datos para que se los compartas.',
      nota: 'En su primer acceso, la app le pide crear su propia contraseña.' },
    { t: 'usuario', titulo: 'Una cuenta', texto: 'Muestra el correo, el área, cuántos días ha cerrado y su último acceso. Con el botón de opciones:',
      lista: [['Editar datos', 'cambias nombre, correo, área o rol.'],
              ['Restablecer contraseña', 'genera una temporal nueva si la olvidó.'],
              ['Desactivar', 'le quitas el acceso sin borrar sus bitácoras.'],
              ['Eliminar', 'borras la cuenta y sus bitácoras del servidor.']] }
  ]
};

const objetivo = (t) => t ? document.querySelector(`[data-guide="${t}"]`) : null;

function guiaAlEntrar() {
  const v = vista;
  if (!asistenteActivo() || guiaVista.has(v)) return;
  setTimeout(() => { if (vista === v && !guiaActual && !rec && !$('.sheet')) abrirGuia(v); }, 400);
}

function cerrarGuia() { guiaActual?.cerrar(); }

function abrirGuia(v = vista) {
  cerrarGuia();
  // Solo los pasos cuyo elemento existe ahora (sin datos, solo celular, etc.); los del menú existen aunque esté cerrado.
  const pasos = (PASOS[v]?.() || []).filter(p => (!p.si || p.si()) && (!p.t || (() => {
    const e = objetivo(p.t);
    return e && (p.m || e.getClientRects().length > 0);
  })()));
  if (!pasos.length) return;
  guiaVista.add(v);

  const PAD = 6, GAP = 12;
  let i = 0, noMostrar = false, timer = 0;
  const raiz = el('<div class="guia" role="dialog" aria-modal="true" aria-labelledby="guia-titulo"></div>');
  document.body.append(raiz);

  const medir = () => {
    const p = pasos[i];
    const e = objetivo(p.t);
    const r = e?.getBoundingClientRect();
    const rect = r && r.width > 0 && r.height > 0 ? r : null;
    const foco = raiz.querySelector('.guia-foco'), velo = raiz.querySelector('.guia-velo'), card = raiz.querySelector('.guia-tarjeta');
    foco.hidden = !rect; velo.hidden = Boolean(rect);
    if (rect) Object.assign(foco.style, { top: `${rect.top - PAD}px`, left: `${rect.left - PAD}px`, width: `${rect.width + PAD * 2}px`, height: `${rect.height + PAD * 2}px` });

    const vw = innerWidth, vh = innerHeight, W = Math.min(360, vw - 32), H = card.offsetHeight;
    const pos = { top: '', bottom: '', left: '', transform: '' };
    if (!rect) {
      Object.assign(pos, { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
    } else if (p.m && esEscritorio()) {
      // En escritorio, los pasos del menú van a la derecha del menú.
      Object.assign(pos, { left: `${rect.right + PAD + GAP + 4}px`, top: `${Math.max(16, Math.min(rect.top, vh - H - 16))}px` });
    } else {
      const left = Math.max(16, Math.min(rect.left + rect.width / 2 - W / 2, vw - W - 16));
      const abajo = vh - (rect.bottom + PAD + GAP), arriba = rect.top - PAD - GAP;
      if (abajo >= 260 || (abajo >= 180 && abajo > arriba)) Object.assign(pos, { top: `${Math.max(16, Math.min(rect.bottom + PAD + GAP, vh - H - 16))}px`, left: `${left}px` });
      else if (arriba >= 180) Object.assign(pos, { bottom: `${vh - (rect.top - PAD - GAP)}px`, left: `${left}px` });
      else Object.assign(pos, { bottom: '16px', left: `${left}px` });
    }
    Object.assign(card.style, pos);
  };

  const pintar = () => {
    const p = pasos[i], ultimo = i === pasos.length - 1;
    raiz.innerHTML = `<div class="guia-velo"></div><div class="guia-foco" hidden></div>
      <div class="guia-tarjeta">
        <div class="filete guia-filete"></div>
        <div class="guia-cuerpo">
          <div class="guia-top"><span class="guia-paso">Asistente · ${i + 1} de ${pasos.length}</span>
            <button class="guia-x" data-g="cerrar" aria-label="Cerrar asistente">${ico('x')}</button></div>
          <h2 class="guia-titulo" id="guia-titulo">${esc(p.titulo)}</h2>
          <p class="guia-texto">${esc(p.texto)}</p>
          ${p.lista ? `<ul class="guia-lista">${p.lista.map(([a, b]) => `<li><b>${esc(a)}:</b> ${esc(b)}</li>`).join('')}</ul>` : ''}
          ${p.nota ? `<div class="guia-nota">${esc(p.nota)}</div>` : ''}
          <div class="guia-avance">${pasos.map((_, n) => `<span class="${n <= i ? 'visto' : ''}"></span>`).join('')}</div>
          <div class="guia-botones">
            ${ultimo ? '<span></span>' : '<button class="guia-saltar" data-g="cerrar">Saltar</button>'}
            <div>
              ${i > 0 ? '<button class="btn contorno" data-g="ant">Anterior</button>' : ''}
              <button class="btn primario" data-g="sig">${ultimo ? 'Entendido' : 'Siguiente'}</button>
            </div>
          </div>
          <label class="guia-casilla"><input type="checkbox" ${noMostrar ? 'checked' : ''}>
            <span>No volver a mostrar el asistente. <span>Puedes reactivarlo desde el menú.</span></span></label>
        </div>
      </div>`;
    raiz.querySelectorAll('[data-g="cerrar"]').forEach(b => b.onclick = cerrar);
    raiz.querySelector('[data-g="ant"]')?.addEventListener('click', anterior);
    raiz.querySelector('[data-g="sig"]').onclick = siguiente;
    raiz.querySelector('.guia-casilla input').onchange = ev => { noMostrar = ev.target.checked; };
    raiz.querySelector('[data-g="sig"]').focus({ preventScroll: true });

    // Pasos del menú: en celular se abre el cajón y se espera a que termine la animación.
    clearTimeout(timer);
    let espera = 40;
    if (p.m && !esEscritorio()) {
      if (!$('#sidebar').classList.contains('abierto')) { abrirMenu(true); espera = 260; }
    } else {
      if (menuPorGuia) { cerrarMenu(); espera = 260; }
      const e = objetivo(p.t);
      if (e) {
        const r = e.getBoundingClientRect();
        if (r.top < 72 || r.bottom > innerHeight - 24) e.scrollIntoView({ block: 'center' });
      }
    }
    // Mientras el cajón se mueve, la tarjeta espera oculta para no saltar de lugar.
    const card = raiz.querySelector('.guia-tarjeta');
    if (espera > 40) card.style.visibility = 'hidden'; else medir();
    timer = setTimeout(() => { card.style.visibility = ''; medir(); }, espera);
  };

  const siguiente = () => { if (i === pasos.length - 1) cerrar(); else { i++; pintar(); } };
  const anterior = () => { if (i > 0) { i--; pintar(); } };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); siguiente(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); anterior(); }
  };
  function cerrar() {
    clearTimeout(timer);
    removeEventListener('resize', medir); removeEventListener('scroll', medir, true);
    document.removeEventListener('keydown', onKey, true);
    raiz.remove();
    if (menuPorGuia) cerrarMenu();
    if (noMostrar) setAsistente(false);
    guiaActual = null;
  }

  addEventListener('resize', medir); addEventListener('scroll', medir, true);
  document.addEventListener('keydown', onKey, true);
  guiaActual = { cerrar };
  pintar();
}

/* ---------------- atajos de teclado ---------------- */
document.addEventListener('keydown', e => {
  if (guiaActual || !YO || $('#app').hidden) return;
  const enCampo = /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable;
  if (e.code === 'Space' && !enCampo && !$('.sheet') && !$('.carga') && vista === 'hoy' && dia(fechaVista).estado === 'abierto') {
    e.preventDefault();
    if (!rec) iniciarGrabacion(); else detenerGrabacion();
  }
  if (e.key === 'Escape' && rec) cancelarGrabacion();
  if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey) && e.target.isContentEditable) { e.preventDefault(); e.target.blur(); snack('Guardado'); }
});

/* ---------------- arranque ---------------- */
arranque();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

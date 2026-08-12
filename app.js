/* Bitácora Diaria por Área — Diseñarte México
   PWA sin build step. Datos locales (localStorage + IndexedDB);
   IA vía funciones serverless en /api. */

const KEY = 'bitacora.v1';
const hoyISO = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

/* ---------------- estado ---------------- */
const defaults = {
  area: { id: 'produccion', nombre: 'Producción', horaCierre: '18:00' },
  usuario: { id: 'u1', nombre: 'Tú' },
  tema: 'auto',
  dias: {}
};
let S = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw ? { ...defaults, ...raw } : structuredClone(defaults);
  } catch { return structuredClone(defaults); }
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }

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

function nav(v, fecha) {
  vista = v;
  if (fecha) fechaVista = fecha;
  document.querySelectorAll('[data-nav]').forEach(b => {
    const on = b.dataset.nav === (v === 'bitacora' ? 'hoy' : v);
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  });
  render();
  $('#main').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => nav(b.dataset.nav, hoyISO()));

function render() {
  const m = $('#main');
  m.innerHTML = '';
  if (vista === 'hoy') m.append(...vistaHoy());
  else if (vista === 'bitacora') m.append(...vistaBitacora());
  else if (vista === 'historial') m.append(...vistaHistorial());
  else m.append(...vistaPerfil());
}

function topbar(titulo, sub, estado, extra = '') {
  return el(`<header class="topbar">
    <div>
      <h1>${esc(titulo)}</h1>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
      ${estado ? `<div style="margin-top:10px"><span class="chip-estado" data-estado="${estado}">${estado}</span></div>` : ''}
    </div>
    <div class="topbar-actions">${extra}</div>
  </header>`);
}

/* ---------------- pantalla: Hoy ---------------- */
function vistaHoy() {
  const d = dia(fechaVista);
  const abierto = d.estado === 'abierto';
  const bar = topbar(S.area.nombre, fechaCorta(d.fecha), d.estado,
    abierto ? `<button class="iconbtn" id="cerrar-dia" title="Cerrar día" aria-label="Cerrar día"><span class="ico">event_available</span></button>` : '');
  bar.querySelector('#cerrar-dia')?.addEventListener('click', confirmarCierre);

  const page = el(`<div class="page"></div>`);

  if (!d.entradas.length) {
    page.append(el(`<div class="empty"><span class="ico">graphic_eq</span>
      <p>Aún no hay entradas de hoy. Mantén presionado el botón para dictar la primera.</p></div>`));
  } else {
    const lista = el('<div class="entradas"></div>');
    [...d.entradas].reverse().forEach(e => lista.append(entradaCard(e, d)));
    page.append(el('<div class="section-title">Entradas del día</div>'), lista);
  }

  const nodes = [bar, page];

  if (abierto) {
    const dock = el(`<div class="capture-dock"><div class="capture-col">
      <div class="capture-hint">Mantén presionado para dictar · toca para escribir</div>
      <button class="fab" id="fab" aria-label="Mantén presionado para dictar, toca para escribir">
        <span class="ico">mic</span><span>Capturar</span>
      </button>
    </div></div>`);
    nodes.push(dock);
    setTimeout(() => wireFab(dock.querySelector('#fab')), 0);
  } else {
    const dock = el(`<div class="capture-dock">
      <button class="fab" id="ver-bit"><span class="ico">description</span><span>Ver bitácora</span></button>
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
        ${e.tipo === 'audio' ? '<span>·</span><span class="ico" style="font-size:14px">mic</span>' : ''}
      </div>
      <p class="entrada-texto ${e.estado !== 'listo' ? 'pendiente' : ''}">${esc(
        e.estado === 'procesando' ? 'Transcribiendo…' :
        e.estado === 'error' ? 'No se pudo transcribir. El audio está guardado.' : e.contenido)}</p>
    </div>
    <div class="entrada-acciones">
      ${e.tipo === 'audio' ? '<button class="mini" data-act="play" aria-label="Reproducir audio"><span class="ico">play_arrow</span></button>' : ''}
      <button class="mini" data-act="menu" aria-label="Opciones de la entrada"><span class="ico">more_vert</span></button>
    </div>
  </article>`);

  if (e.estado === 'error') {
    const b = el('<button class="reintentar">Reintentar o escribir el texto</button>');
    b.onclick = () => editarEntrada(e, d);
    c.querySelector('.entrada-body').append(b);
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
    <button class="list-opt" data-a="editar"><span class="ico">edit</span>Editar texto</button>
    <button class="list-opt" data-a="borrar" style="color:var(--error)"><span class="ico">delete</span>Eliminar entrada</button>`,
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
    <div class="sheet-actions"><button class="btn text" data-a="cancel">Cancelar</button><button class="btn filled" data-a="ok">Guardar</button></div>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="cancel"]').onclick = close;
      s.querySelector('[data-a="ok"]').onclick = () => {
        e.contenido = s.querySelector('#t').value.trim();
        e.estado = 'listo'; save(); close(); render(); snack('Entrada guardada');
      };
    } });
}

/* ---------------- captura ---------------- */
let rec = null, chunks = [], recStart = 0, recTimer = null, esLargo = false, holdTimer = null, stream = null, analyser = null, rafId = null;

function wireFab(fab) {
  const start = (ev) => {
    ev.preventDefault();
    esLargo = false;
    holdTimer = setTimeout(() => { esLargo = true; iniciarGrabacion(); }, 320);
  };
  const end = () => {
    clearTimeout(holdTimer);
    if (esLargo) detenerGrabacion(); else abrirTexto();
    esLargo = false;
  };
  fab.addEventListener('pointerdown', start);
  fab.addEventListener('pointerup', end);
  fab.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (esLargo) cancelarGrabacion(); esLargo = false; });
  fab.addEventListener('contextmenu', e => e.preventDefault());
}

function abrirTexto() {
  sheet(`<h2>Escribir entrada</h2>
    <textarea class="field" id="t" placeholder="¿Qué pasó o qué hiciste?"></textarea>
    <div class="sheet-actions"><button class="btn text" data-a="cancel">Cancelar</button><button class="btn filled" data-a="ok">Agregar</button></div>`,
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
    esLargo = false;
    return snack('No se pudo usar el micrófono. Revisa los permisos o escribe la entrada.');
  }
  chunks = [];
  rec = new MediaRecorder(stream);
  rec.ondataavailable = ev => chunks.push(ev.data);
  rec.start();
  recStart = Date.now();

  recOverlay = el(`<div class="rec-overlay"><div class="rec-card">
    <div class="rec-wave">${'<span class="rec-bar"></span>'.repeat(13)}</div>
    <p class="rec-time">0:00</p>
    <p class="rec-hint">Suelta para guardar</p>
  </div></div>`);
  document.body.append(recOverlay);
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
    if (dur < 700) return snack('Grabación muy corta. Mantén presionado mientras hablas.');
    const e = agregarEntrada({ tipo: 'audio', estado: 'procesando' });
    await putAudio(e.id, blob);
    transcribir(e, blob);
  };
  rec.stop();
}

async function transcribir(e, blob) {
  try {
    const b64 = await blobB64(blob);
    const r = await fetch('/api/transcribir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: b64, mime: blob.type || 'audio/webm' })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Error del servidor');
    const { texto } = j;
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
  sheet(`<h2>Cerrar el día</h2>
    <p style="font-size:14px;color:var(--on-surface-variant);line-height:1.5;margin:0">
      Se dejarán de aceptar entradas y se generará la bitácora con las ${d.entradas.length} entradas capturadas.</p>
    <div class="sheet-actions"><button class="btn text" data-a="cancel">Cancelar</button><button class="btn filled" data-a="ok">Cerrar día</button></div>`,
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
  snack('Generando bitácora…');
  const entradas = d.entradas.filter(e => e.contenido).map(e => ({ id: e.id, hora: e.hora, texto: e.contenido }));
  try {
    const r = await fetch('/api/generar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: S.area.nombre, fecha: d.fecha, entradas })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Error del servidor');
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
  }
  save();
}

/* ---------------- pantalla: Bitácora ---------------- */
function vistaBitacora() {
  const d = dia(fechaVista);
  const bar = topbar(S.area.nombre, fechaLarga(d.fecha), d.estado,
    `<button class="iconbtn" id="regen" title="Regenerar" aria-label="Regenerar bitácora"><span class="ico">autorenew</span></button>`);
  bar.querySelector('#regen').onclick = () => {
    sheet(`<h2>Regenerar bitácora</h2>
      <p style="font-size:14px;color:var(--on-surface-variant);line-height:1.5;margin:0">Se pierden las ediciones que hayas hecho.</p>
      <div class="sheet-actions"><button class="btn text" data-a="cancel">Cancelar</button><button class="btn filled" data-a="ok">Regenerar</button></div>`,
    { onMount: (s, close) => {
        s.querySelector('[data-a="cancel"]').onclick = close;
        s.querySelector('[data-a="ok"]').onclick = async () => { close(); await generar(d); render(); };
      } });
  };

  const page = el('<div class="page"></div>');

  if (!d.bitacora) {
    page.append(el(`<div class="empty"><span class="ico">description</span>
      <p>Este día se cerró sin entradas, así que no hay bitácora.</p></div>`));
    return [bar, page];
  }
  d.revisado = true; save();

  const panes = el('<div class="panes dual"></div>');
  const izq = el('<aside class="pane-entradas"></aside>');
  izq.append(el('<div class="section-title" style="margin-top:0">Entradas capturadas</div>'));
  const li = el('<div class="entradas"></div>');
  [...d.entradas].reverse().forEach(e => li.append(entradaCard(e, d)));
  izq.append(li);

  const der = el('<section class="pane-actividades"></section>');
  if (d.bitacora.sinIA) {
    const av = el(`<div class="aviso"><span class="ico">warning</span>
      <div><strong>Borrador sin IA.</strong> Cada entrada quedó como una actividad tal cual.
      <div class="aviso-detalle">${esc(d.bitacora.errorIA || 'El servicio no respondió.')}</div></div></div>`);
    der.append(av);
  }
  der.append(el('<div class="section-title" style="margin-top:0">Actividades</div>'));
  d.bitacora.actividades.forEach((a, i) => der.append(actCard(a, i, d)));

  const add = el('<button class="btn outlined" style="width:100%"><span class="ico">add</span>Agregar actividad</button>');
  add.onclick = () => {
    d.bitacora.actividades.push({ id: uid(), titulo: 'Nueva actividad', descripcion: '', entradasRef: [] });
    save(); render();
  };
  der.append(add);

  const con = el(`<div class="conclusion">
    <h3>Conclusión del día</h3>
    <p class="txt" contenteditable="true" role="textbox" aria-label="Conclusión del día">${esc(d.bitacora.conclusion || 'Escribe aquí la conclusión del día.')}</p>
  </div>`);
  con.querySelector('.txt').addEventListener('blur', ev => { d.bitacora.conclusion = ev.target.textContent.trim(); save(); });
  der.append(el('<div class="section-title">Cierre</div>'), con);

  const acciones = el(`<div class="btn-row">
    <button class="btn filled" id="exp"><span class="ico">picture_as_pdf</span>Exportar PDF</button>
    <button class="btn outlined" id="marcar">Marcar como listo</button>
  </div>`);
  acciones.querySelector('#exp').onclick = () => exportar(d);
  acciones.querySelector('#marcar').onclick = () => { d.estado = 'listo'; d.revisadoEn = new Date().toISOString(); save(); render(); snack('Bitácora marcada como lista'); };
  der.append(acciones);

  panes.append(izq, der);
  page.append(panes);
  return [bar, page];
}

function actCard(a, i, d) {
  const c = el(`<article class="act">
    <div class="act-head">
      <span class="act-num">${i + 1}</span>
      <h3 class="act-titulo" contenteditable="true" role="textbox" aria-label="Título de la actividad ${i + 1}">${esc(a.titulo)}</h3>
      <div class="act-tools">
        <button class="mini" data-a="up" aria-label="Subir"><span class="ico">arrow_upward</span></button>
        <button class="mini" data-a="down" aria-label="Bajar"><span class="ico">arrow_downward</span></button>
        <button class="mini" data-a="del" aria-label="Eliminar actividad"><span class="ico">delete</span></button>
      </div>
    </div>
    <p class="act-desc" contenteditable="true" role="textbox" aria-label="Descripción de la actividad ${i + 1}">${esc(a.descripcion)}</p>
  </article>`);

  c.querySelector('.act-titulo').addEventListener('blur', e => { a.titulo = e.target.textContent.trim(); save(); });
  c.querySelector('.act-desc').addEventListener('blur', e => { a.descripcion = e.target.textContent.trim(); save(); });

  const arr = d.bitacora.actividades;
  const mover = (n) => { const j = i + n; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; save(); render(); };
  c.querySelector('[data-a="up"]').onclick = () => mover(-1);
  c.querySelector('[data-a="down"]').onclick = () => mover(1);
  c.querySelector('[data-a="del"]').onclick = () => { arr.splice(i, 1); save(); render(); snack('Actividad eliminada'); };

  const audios = (a.entradasRef || []).map(id => d.entradas.find(e => e.id === id)).filter(e => e && e.tipo === 'audio');
  if (audios.length) {
    const box = el('<div class="act-audios"></div>');
    audios.forEach(e => {
      const b = el(`<button class="audio-pill"><span class="ico">play_arrow</span>Audio ${esc(e.hora)}</button>`);
      b.onclick = () => reproducir(e.id);
      box.append(b);
    });
    c.append(box);
  }
  return c;
}

/* ---------------- pantalla: Historial ---------------- */
function vistaHistorial() {
  const bar = topbar('Historial', S.area.nombre);
  const page = el('<div class="page"></div>');
  const buscador = el(`<div class="search"><span class="ico">search</span><input id="q" placeholder="Buscar en las bitácoras" aria-label="Buscar"></div>`);
  const cont = el('<div id="lista-dias"></div>');
  page.append(buscador, cont);

  const pintar = (q = '') => {
    cont.innerHTML = '';
    const dias = Object.values(S.dias)
      .filter(d => d.fecha !== hoyISO() || d.estado !== 'abierto')
      .filter(d => !q || JSON.stringify(d).toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    if (!dias.length) {
      cont.append(el(`<div class="empty"><span class="ico">history</span><p>Todavía no hay días cerrados. Aparecerán aquí al cerrar el primero.</p></div>`));
      return;
    }
    let mesActual = '';
    dias.forEach(d => {
      const [y, m] = d.fecha.split('-');
      const etiqueta = `${MESES[+m - 1]} ${y}`;
      if (etiqueta !== mesActual) { mesActual = etiqueta; cont.append(el(`<div class="mes">${esc(etiqueta)}</div>`)); }
      const n = d.bitacora?.actividades.length || 0;
      const row = el(`<button class="dia-row">
        <div class="grow" style="flex:1">
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
  return [bar, page];
}

/* ---------------- pantalla: Perfil ---------------- */
function vistaPerfil() {
  const bar = topbar('Perfil', 'Ajustes del área');
  const page = el(`<div class="page">
    <div class="section-title">Área</div>
    <div class="card">
      <div class="row"><div class="grow"><div class="row-label">Nombre del área</div></div>
        <input class="input" id="area" value="${esc(S.area.nombre)}"></div>
      <div class="row"><div class="grow"><div class="row-label">Cierre automático</div>
        <div class="row-sub">La bitácora se genera sola a esta hora</div></div>
        <input class="input" id="hora" type="time" value="${esc(S.area.horaCierre)}"></div>
    </div>
    <div class="section-title">Tu cuenta</div>
    <div class="card">
      <div class="row"><div class="grow"><div class="row-label">Tu nombre</div>
        <div class="row-sub">Se guarda con cada entrada, no aparece en el PDF por actividad</div></div>
        <input class="input" id="nombre" value="${esc(S.usuario.nombre)}"></div>
      <div class="row"><div class="grow"><div class="row-label">Tema</div>
        <div class="row-sub">Auto sigue la configuración del sistema</div></div>
        <div class="segmented" id="tema" role="radiogroup" aria-label="Tema">
          <button role="radio" data-t="auto" aria-checked="${S.tema === 'auto'}">Auto</button>
          <button role="radio" data-t="light" aria-checked="${S.tema === 'light'}">Claro</button>
          <button role="radio" data-t="dark" aria-checked="${S.tema === 'dark'}">Oscuro</button>
        </div></div>
    </div>
    <div class="section-title">Datos</div>
    <div class="card">
      <div class="row"><div class="grow"><div class="row-label">Días guardados</div>
        <div class="row-sub">${Object.keys(S.dias).length} en este dispositivo</div></div></div>
    </div>
    <p style="font-size:12px;color:var(--on-surface-variant);margin-top:24px;text-align:center">
      Diseñarte México · Marketing e Innovación Digital</p>
  </div>`);

  page.querySelector('#area').onchange = e => { S.area.nombre = e.target.value.trim() || 'Área'; save(); render(); };
  page.querySelector('#hora').onchange = e => { S.area.horaCierre = e.target.value; save(); snack('Hora de cierre guardada'); };
  page.querySelector('#nombre').onchange = e => { S.usuario.nombre = e.target.value.trim() || 'Tú'; save(); };
  page.querySelectorAll('#tema [data-t]').forEach(b => b.onclick = () => { S.tema = b.dataset.t; save(); aplicarTema(); render(); });
  return [bar, page];
}

function aplicarTema() {
  const dark = S.tema === 'dark' || (S.tema === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#151217' : '#A53692';
}

/* ---------------- PDF ---------------- */
function nombreArchivo(d) {
  const area = S.area.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '');
  return `Bitacora_${area}_${d.fecha}.pdf`;
}

async function construirPDF(d) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 56; let y = M;

  const nueva = () => { doc.addPage(); y = M; };
  const espacio = (n) => { if (y + n > H - 70) nueva(); };

  doc.setFillColor(165, 54, 146); doc.rect(0, 0, W, 8, 'F');
  y = M + 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(29, 27, 30);
  doc.text('Bitácora diaria', M, y);
  y += 22;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(74, 69, 78);
  doc.text(`${S.area.nombre} · ${fechaLarga(d.fecha)}`, M, y);
  y += 12;
  doc.setDrawColor(221, 214, 219); doc.line(M, y, W - M, y);
  y += 30;

  (d.bitacora?.actividades || []).forEach((a, i) => {
    espacio(70);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(29, 27, 30);
    const t = doc.splitTextToSize(`${i + 1}. ${a.titulo}`, W - M * 2);
    doc.text(t, M, y); y += t.length * 16 + 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(60, 56, 62);
    const p = doc.splitTextToSize(a.descripcion || '', W - M * 2 - 14);
    espacio(p.length * 14);
    doc.text(p, M + 14, y); y += p.length * 14 + 20;
  });

  if (d.bitacora?.conclusion) {
    espacio(110);
    const p = doc.splitTextToSize(d.bitacora.conclusion, W - M * 2 - 34);
    const h = p.length * 14 + 44;
    doc.setFillColor(251, 217, 242); doc.rect(M, y, W - M * 2, h, 'F');
    doc.setFillColor(165, 54, 146); doc.rect(M, y, 5, h, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(123, 7, 166);
    doc.text('CONCLUSIÓN DEL DÍA', M + 18, y + 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(45, 20, 45);
    doc.text(p, M + 18, y + 38);
    y += h + 24;
  }

  const capturaron = [...new Set(d.entradas.map(e => e.usuarioNombre))].join(', ') || '—';
  const pags = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pags; i++) {
    doc.setPage(i);
    doc.setDrawColor(221, 214, 219); doc.line(M, H - 58, W - M, H - 58);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 115, 123);
    doc.text(`Capturaron: ${capturaron} · ${d.entradas.length} entradas`, M, H - 42);
    doc.text('Diseñarte México', M, H - 30);
    doc.text(`${i} / ${pags}`, W - M, H - 30, { align: 'right' });
  }
  return doc;
}

async function exportar(d) {
  if (!window.jspdf) return snack('El generador de PDF aún está cargando. Intenta de nuevo.');
  const doc = await construirPDF(d);
  const nombre = nombreArchivo(d);
  const blob = doc.output('blob');
  const file = new File([blob], nombre, { type: 'application/pdf' });
  const puedeCompartir = navigator.canShare?.({ files: [file] });

  sheet(`<h2>Exportar bitácora</h2>
    <p style="font-size:14px;color:var(--on-surface-variant);margin:0 0 12px">${esc(nombre)}</p>
    <button class="list-opt" data-a="desc"><span class="ico">download</span>Descargar</button>
    ${puedeCompartir ? '<button class="list-opt" data-a="share"><span class="ico">share</span>Compartir</button>' : ''}
    <button class="list-opt" data-a="prev"><span class="ico">visibility</span>Vista previa</button>`,
  { onMount: (s, close) => {
      s.querySelector('[data-a="desc"]').onclick = () => { doc.save(nombre); close(); snack('PDF exportado'); };
      s.querySelector('[data-a="prev"]').onclick = () => { window.open(URL.createObjectURL(blob), '_blank'); close(); };
      s.querySelector('[data-a="share"]')?.addEventListener('click', async () => {
        try { await navigator.share({ files: [file], title: nombre }); snack('PDF compartido'); } catch {}
        close();
      });
    } });
}

/* ---------------- cierre automático ---------------- */
function revisarCierreAutomatico() {
  const d = dia(hoyISO());
  if (d.estado !== 'abierto') return;
  const [h, m] = (S.area.horaCierre || '18:00').split(':').map(Number);
  const ahora = new Date();
  if (ahora.getHours() * 60 + ahora.getMinutes() >= h * 60 + m) cerrarDia(d);
}

/* ---------------- atajos de teclado ---------------- */
document.addEventListener('keydown', e => {
  const enCampo = /input|textarea/i.test(e.target.tagName) || e.target.isContentEditable;
  if (e.code === 'Space' && !enCampo && vista === 'hoy' && dia(fechaVista).estado === 'abierto') {
    e.preventDefault();
    if (!rec) { esLargo = true; iniciarGrabacion(); } else detenerGrabacion();
  }
  if (e.key === 'Escape' && rec) cancelarGrabacion();
  if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey) && e.target.isContentEditable) { e.preventDefault(); e.target.blur(); snack('Guardado'); }
});

/* ---------------- arranque ---------------- */
aplicarTema();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.tema === 'auto') { aplicarTema(); } });
nav('hoy');
revisarCierreAutomatico();
setInterval(revisarCierreAutomatico, 60000);

window.addEventListener('scroll', () => {
  document.querySelector('.topbar')?.classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

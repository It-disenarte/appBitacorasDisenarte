/* Panel de administración: alta, edición, contraseña temporal, baja.
   Solo para administradores. */
import { ruta, q, ErrorApi, texto, correo, password, requiereAdmin, hashPassword } from './_servidor.js';

const ROLES = new Set(['admin', 'usuario']);
const rol = (v) => { if (!ROLES.has(v)) throw new ErrorApi(400, 'Rol no válido.'); return v; };

const fila = (u) => ({
  id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, area: u.area, activo: u.activo,
  debeCambiar: u.debe_cambiar, creadoEn: u.creado_en, ultimoAcceso: u.ultimo_acceso,
  ...(u.dias === undefined ? {} : { dias: Number(u.dias) })
});

async function buscar(id) {
  const [u] = await q('SELECT * FROM bitacora_usuarios WHERE id = $1', [Number(id) || 0]);
  if (!u) throw new ErrorApi(404, 'Ese usuario ya no existe.');
  return u;
}

/* Que nunca se quede la app sin un admin activo. */
async function otrosAdmins(id) {
  const [{ n }] = await q("SELECT count(*)::int AS n FROM bitacora_usuarios WHERE rol = 'admin' AND activo AND id <> $1", [id]);
  return n;
}

const duplicado = (e) => {
  if (e.code === '23505') throw new ErrorApi(409, 'Ya hay una cuenta con ese correo.');
  throw e;
};

export default ruta({
  async GET(req) {
    await requiereAdmin(req);
    const filas = await q(`SELECT u.*,
        (SELECT count(*) FROM bitacora_dias d WHERE d.usuario_id = u.id AND d.datos->>'estado' <> 'abierto') AS dias
      FROM bitacora_usuarios u ORDER BY u.activo DESC, lower(u.nombre)`);
    return { usuarios: filas.map(fila) };
  },

  async POST(req, res, body) {
    await requiereAdmin(req);
    const datos = [
      texto(body.nombre, 'El nombre', { min: 2 }),
      correo(body.email),
      await hashPassword(password(body.password)),
      rol(body.rol || 'usuario'),
      texto(body.area, 'El área', { max: 60 })
    ];
    const [u] = await q(`INSERT INTO bitacora_usuarios (nombre, email, password_hash, rol, area, debe_cambiar)
      VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`, datos).catch(duplicado);
    res.status(201);
    return { usuario: fila({ ...u, dias: 0 }) };
  },

  async PATCH(req, res, body) {
    const yo = await requiereAdmin(req);
    const u = await buscar(body.id);
    const propio = u.id === yo.id;

    const nombre = body.nombre === undefined ? u.nombre : texto(body.nombre, 'El nombre', { min: 2 });
    const email = body.email === undefined ? u.email : correo(body.email);
    const area = body.area === undefined ? u.area : texto(body.area, 'El área', { max: 60 });
    const nuevoRol = body.rol === undefined ? u.rol : rol(body.rol);
    const activo = body.activo === undefined ? u.activo : Boolean(body.activo);

    if (propio && nuevoRol !== 'admin') throw new ErrorApi(400, 'No puedes quitarte el rol de administrador a ti mismo.');
    if (propio && !activo) throw new ErrorApi(400, 'No puedes desactivar tu propia cuenta.');
    if (u.rol === 'admin' && (nuevoRol !== 'admin' || !activo) && !(await otrosAdmins(u.id))) {
      throw new ErrorApi(400, 'Debe quedar al menos un administrador activo.');
    }

    let hash = u.password_hash, debeCambiar = u.debe_cambiar;
    if (body.password !== undefined) {
      if (propio) throw new ErrorApi(400, 'Cambia tu propia contraseña desde "Cambiar contraseña" en el menú.');
      hash = await hashPassword(password(body.password));
      debeCambiar = true;
    }

    const [act] = await q(`UPDATE bitacora_usuarios SET nombre = $2, email = $3, area = $4, rol = $5, activo = $6,
        password_hash = $7, debe_cambiar = $8, fallos = 0, bloqueado_hasta = NULL
      WHERE id = $1 RETURNING *`, [u.id, nombre, email, area, nuevoRol, activo, hash, debeCambiar]).catch(duplicado);

    // Contraseña nueva o cuenta desactivada: se cierran sus sesiones abiertas.
    if (body.password !== undefined || !activo) await q('DELETE FROM bitacora_sesiones WHERE usuario_id = $1', [u.id]);
    return { usuario: fila(act) };
  },

  async DELETE(req) {
    const yo = await requiereAdmin(req);
    const u = await buscar(new URL(req.url, 'http://x').searchParams.get('id'));
    if (u.id === yo.id) throw new ErrorApi(400, 'No puedes eliminar tu propia cuenta.');
    if (u.rol === 'admin' && u.activo && !(await otrosAdmins(u.id))) throw new ErrorApi(400, 'Debe quedar al menos un administrador activo.');
    await q('DELETE FROM bitacora_usuarios WHERE id = $1', [u.id]);
    return { ok: true };
  }
});

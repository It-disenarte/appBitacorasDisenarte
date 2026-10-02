/* La cuenta de quien tiene la sesión.
   PATCH: nombre y área. POST: cambiar la contraseña. */
import {
  ruta, q, ErrorApi, texto, password, requiereUsuario, hashPassword,
  verificarPassword, tokenActual, publico
} from './_servidor.js';

export default ruta({
  async PATCH(req, res, body) {
    const u = await requiereUsuario(req);
    const nombre = body.nombre === undefined ? u.nombre : texto(body.nombre, 'El nombre', { min: 2 });
    const area = body.area === undefined ? u.area : texto(body.area, 'El área', { max: 60 });
    const [act] = await q('UPDATE bitacora_usuarios SET nombre = $2, area = $3 WHERE id = $1 RETURNING *', [u.id, nombre, area]);
    return { usuario: publico(act) };
  },

  async POST(req, res, body) {
    const u = await requiereUsuario(req);
    const nueva = password(body.nueva);
    // Con contraseña temporal (primer acceso) no se pide la actual: acaba de usarla para entrar.
    if (!u.debe_cambiar && !(await verificarPassword(u.password_hash, String(body.actual || '')))) {
      throw new ErrorApi(400, 'La contraseña actual no es correcta.');
    }
    if (await verificarPassword(u.password_hash, nueva)) throw new ErrorApi(400, 'La contraseña nueva debe ser distinta de la actual.');
    const [act] = await q('UPDATE bitacora_usuarios SET password_hash = $2, debe_cambiar = FALSE WHERE id = $1 RETURNING *',
      [u.id, await hashPassword(nueva)]);
    // Cierra las demás sesiones abiertas con la contraseña anterior.
    await q('DELETE FROM bitacora_sesiones WHERE usuario_id = $1 AND token_hash <> $2', [u.id, tokenActual(req)]);
    return { usuario: publico(act) };
  }
});

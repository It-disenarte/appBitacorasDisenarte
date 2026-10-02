/* GET: estado de la sesión (y si falta la configuración inicial).
   POST: entrar con correo y contraseña. DELETE: salir. */
import {
  ruta, q, ErrorApi, correo, usuarioDe, abrirSesion, cerrarSesion,
  verificarPassword, HASH_FALSO, publico
} from './_servidor.js';

const MAX_FALLOS = 5;

export default ruta({
  async GET(req) {
    const [{ hay }] = await q('SELECT EXISTS (SELECT 1 FROM bitacora_usuarios) AS hay');
    if (!hay) return { configurar: true, usuario: null };
    const u = await usuarioDe(req);
    return { configurar: false, usuario: u ? publico(u) : null };
  },

  async POST(req, res, body) {
    const email = correo(body.email);
    const pw = typeof body.password === 'string' ? body.password : '';
    const [u] = await q('SELECT * FROM bitacora_usuarios WHERE email = $1', [email]);

    if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      throw new ErrorApi(429, 'Demasiados intentos fallidos. Espera unos minutos y vuelve a intentarlo.');
    }
    const ok = await verificarPassword(u?.password_hash || HASH_FALSO, pw);
    if (!u || !ok) {
      if (u) {
        await q(`UPDATE bitacora_usuarios SET
            fallos = CASE WHEN fallos + 1 >= $2 THEN 0 ELSE fallos + 1 END,
            bloqueado_hasta = CASE WHEN fallos + 1 >= $2 THEN now() + interval '10 minutes' ELSE bloqueado_hasta END
          WHERE id = $1`, [u.id, MAX_FALLOS]);
      }
      throw new ErrorApi(401, 'Correo o contraseña incorrectos.');
    }
    if (!u.activo) throw new ErrorApi(403, 'Tu cuenta está desactivada. Habla con el administrador.');

    await abrirSesion(req, res, u.id);
    return { usuario: publico(u) };
  },

  async DELETE(req, res) {
    await cerrarSesion(req, res);
    return { ok: true };
  }
});

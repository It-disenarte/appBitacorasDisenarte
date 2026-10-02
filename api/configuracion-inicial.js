/* Crea la cuenta del primer administrador. Pública solo mientras no exista ninguna
   cuenta; después responde 409 siempre. */
import { ruta, transaccion, ErrorApi, texto, correo, password, hashPassword, abrirSesion, publico } from './_servidor.js';

export default ruta({
  async POST(req, res, body) {
    const nombre = texto(body.nombre, 'El nombre', { min: 2 });
    const email = correo(body.email);
    const area = texto(body.area || 'Dirección', 'El área', { max: 60 });
    const hash = await hashPassword(password(body.password));

    const u = await transaccion(async (tq) => {
      // Bloquea la tabla para que dos envíos simultáneos no creen dos admins.
      await tq('LOCK TABLE bitacora_usuarios IN EXCLUSIVE MODE');
      const [{ hay }] = await tq('SELECT EXISTS (SELECT 1 FROM bitacora_usuarios) AS hay');
      if (hay) throw new ErrorApi(409, 'La configuración inicial ya se hizo. Entra con tu correo y contraseña.');
      const [nuevo] = await tq(`INSERT INTO bitacora_usuarios (nombre, email, password_hash, rol, area)
        VALUES ($1, $2, $3, 'admin', $4) RETURNING *`, [nombre, email, hash, area]);
      return nuevo;
    });

    await abrirSesion(req, res, u.id);
    res.status(201);
    return { usuario: publico(u) };
  }
});

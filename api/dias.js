/* Las bitácoras de quien tiene la sesión. Cada día se guarda completo (entradas,
   actividades y conclusión) como JSON. Los audios se quedan en el dispositivo.
   GET: todos los días. PUT: guarda un lote; gana la versión más reciente. */
import { ruta, q, ErrorApi, requiereUsuario } from './_servidor.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LOTE = 50;
const MAX_DIA = 1_000_000; // bytes de JSON por día

const salida = (f) => ({ fecha: f.fecha, datos: f.datos, actualizado: Number(f.actualizado) });

export default ruta({
  async GET(req) {
    const u = await requiereUsuario(req);
    const filas = await q(`SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, datos, actualizado
      FROM bitacora_dias WHERE usuario_id = $1 ORDER BY fecha`, [u.id]);
    return { dias: filas.map(salida) };
  },

  async PUT(req, res, body) {
    const u = await requiereUsuario(req);
    const lote = Array.isArray(body.dias) ? body.dias : [];
    if (!lote.length) return { guardados: [], masNuevos: [] };
    if (lote.length > MAX_LOTE) throw new ErrorApi(400, `Máximo ${MAX_LOTE} días por envío.`);

    const guardados = [], masNuevos = [];
    for (const d of lote) {
      const fecha = String(d?.fecha || '');
      const actualizado = Number(d?.actualizado);
      if (!FECHA.test(fecha) || !d.datos || typeof d.datos !== 'object' || !Number.isFinite(actualizado)) {
        throw new ErrorApi(400, 'Día con formato no válido.');
      }
      const json = JSON.stringify({ ...d.datos, fecha });
      if (json.length > MAX_DIA) throw new ErrorApi(413, `El día ${fecha} es demasiado grande para guardarlo.`);

      // Solo se escribe si lo que llega es igual o más nuevo que lo guardado.
      const [ok] = await q(`INSERT INTO bitacora_dias (usuario_id, fecha, datos, actualizado)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (usuario_id, fecha) DO UPDATE
          SET datos = EXCLUDED.datos, actualizado = EXCLUDED.actualizado, guardado_en = now()
          WHERE bitacora_dias.actualizado <= EXCLUDED.actualizado
        RETURNING 1 AS ok`, [u.id, fecha, json, actualizado]);
      if (ok) { guardados.push(fecha); continue; }

      const [actual] = await q(`SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, datos, actualizado
        FROM bitacora_dias WHERE usuario_id = $1 AND fecha = $2`, [u.id, fecha]);
      if (actual) masNuevos.push(salida(actual));
    }
    return { guardados, masNuevos };
  }
});

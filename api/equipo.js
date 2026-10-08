/* Bitácoras de todos, de solo lectura, para visores y administradores.
   GET ?semana=AAAA-MM-DD (el lunes): las personas que capturan y sus días de esa semana. */
import { ruta, q, ErrorApi, requiereVisor } from './_servidor.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/* Solo lo que se muestra: sin la transcripción cruda ni datos internos. */
const entrada = (e) => ({ id: e.id, hora: e.hora, tipo: e.tipo, usuarioNombre: e.usuarioNombre, contenido: e.contenido, estado: e.estado });
const bitacora = (b) => b && ({
  actividades: (b.actividades || []).map(a => ({ titulo: a.titulo, descripcion: a.descripcion })),
  conclusion: b.conclusion || ''
});

export default ruta({
  async GET(req) {
    await requiereVisor(req);
    const lunes = String(req.query?.semana ?? new URL(req.url, 'http://x').searchParams.get('semana') ?? '');
    if (!FECHA.test(lunes) || Number.isNaN(Date.parse(lunes))) throw new ErrorApi(400, 'Semana no válida.');

    // Todas las cuentas activas y cualquiera que tenga días en la semana.
    const usuarios = await q(`SELECT id, nombre, area, rol, activo FROM bitacora_usuarios u
      WHERE u.activo
         OR EXISTS (SELECT 1 FROM bitacora_dias d WHERE d.usuario_id = u.id AND d.fecha BETWEEN $1::date AND $1::date + 6)
      ORDER BY lower(u.area), lower(u.nombre)`, [lunes]);

    const filas = await q(`SELECT usuario_id, to_char(fecha, 'YYYY-MM-DD') AS fecha, datos FROM bitacora_dias
      WHERE fecha BETWEEN $1::date AND $1::date + 6 ORDER BY fecha`, [lunes]);

    const dias = filas
      .map(f => ({ ...f, entradas: (f.datos.entradas || []).filter(e => e.estado === 'listo' && e.contenido) }))
      .filter(f => f.datos.estado !== 'abierto' || f.entradas.length)
      .map(f => ({
        usuarioId: f.usuario_id,
        fecha: f.fecha,
        estado: f.datos.estado,
        entradas: f.entradas.map(entrada),
        bitacora: bitacora(f.datos.bitacora)
      }));

    return { semana: lunes, usuarios, dias };
  }
});

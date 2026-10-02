import { callGemini, leerBody } from './_gemini.js';
import { conSesion } from './_servidor.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!(await conSesion(req, res))) return;
  try {
    const { area, fecha, actividades } = await leerBody(req);
    if (!actividades?.length) return res.status(400).json({ error: 'No hay actividades' });

    const prompt = `Eres el redactor de la bitácora diaria del área de ${area} en Diseñarte México, ${fecha}.

Escribe únicamente la conclusión del día a partir de estas actividades ya redactadas.

Reglas:
- 3 a 5 oraciones, en tercera persona y en pasado.
- Conserva los nombres de personas, clientes y empresas, y los datos importantes (horas, fechas, cantidades, folios) tal como aparecen en las actividades.
- Incluye las incidencias, sin suavizarlas.
- No evalúes, no califiques, no sugieras mejoras. Solo cuenta lo que ocurrió.
- No inventes nada que no esté en las actividades.

Actividades:
${actividades.map((a, i) => `${i + 1}. ${a.titulo}: ${a.descripcion}`).join('\n')}

Devuelve JSON estricto: {"conclusion":""}`;

    const raw = await callGemini([{ text: prompt }], { json: true });
    let data;
    try { data = JSON.parse(raw); }
    catch { data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }

    res.status(200).json({ conclusion: data.conclusion || '' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}

import { callGemini, GLOSARIO, leerBody } from './_gemini.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { area, fecha, entradas } = await leerBody(req);
    if (!entradas?.length) return res.status(400).json({ error: 'No hay entradas' });

    const prompt = `Eres el redactor de la bitácora diaria del área de ${area} en Diseñarte México, ${fecha}.

${GLOSARIO}

Recibes las entradas sueltas que el personal capturó durante el día, con su hora e id.
Agrúpalas: varias entradas de distintas horas sobre el mismo asunto son UNA sola actividad.

Reglas:
- Redacta en tercera persona y en voz del área, nunca de personas ("se atendieron 4 órdenes de corte", nunca "Juan hizo").
- **Ninguna entrada se queda fuera.** Toda entrada debe quedar reflejada en alguna actividad, aunque no sea trabajo de producción: incidencias, fallas de equipo, accidentes, retrasos, visitas, faltas de material o conflictos entre personal se registran igual que lo demás.
- Las incidencias se registran tal como se reportaron, sin suavizarlas ni omitirlas. Si el reporte menciona a una persona por nombre en una incidencia, consérvalo.
- No evalúes, no califiques, no sugieras mejoras, no asignes culpas. Solo redacta lo que pasó.
- Título breve (máx. 8 palabras). Descripción de 1 a 3 oraciones.
- La conclusión resume el día en 2 o 3 oraciones e incluye las incidencias relevantes.
- entradas_ref lleva los id de las entradas que originaron cada actividad.
- No inventes nada que no esté en las entradas.

Entradas:
${entradas.map(e => `[${e.id}] ${e.hora} — ${e.texto}`).join('\n')}

Devuelve JSON estricto con esta forma:
{"actividades":[{"titulo":"","descripcion":"","entradas_ref":[]}],"conclusion":"","entidades_detectadas":[]}`;

    const raw = await callGemini([{ text: prompt }], { json: true });
    let data;
    try { data = JSON.parse(raw); }
    catch { data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }

    res.status(200).json({
      actividades: Array.isArray(data.actividades) ? data.actividades : [],
      conclusion: data.conclusion || '',
      entidades_detectadas: data.entidades_detectadas || []
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}

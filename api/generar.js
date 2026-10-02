import { callGemini, GLOSARIO, leerBody } from './_gemini.js';
import { conSesion } from './_servidor.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!(await conSesion(req, res))) return;
  try {
    const { area, fecha, entradas } = await leerBody(req);
    if (!entradas?.length) return res.status(400).json({ error: 'No hay entradas' });

    const prompt = `Eres el redactor de la bitácora diaria del área de ${area} en Diseñarte México, ${fecha}.

${GLOSARIO}

Recibes las entradas sueltas que el personal capturó durante el día, con su hora de captura e id.
Tu trabajo es ORDENAR y REDACTAR con claridad, NO resumir. La bitácora es un registro: vale más completa que corta.

Reglas:
- **No resumas ni recortes.** Cada actividad debe conservar TODO lo que dicen sus entradas. Si la entrada es larga, la descripción también lo es; usa tantas oraciones como hagan falta.
- **Conserva todos los datos tal cual:** horas, fechas, días, plazos, cantidades, medidas, precios, folios, números de orden o de pedido, direcciones, materiales, equipos, clientes, proveedores y cualquier otro dato concreto. No los redondees, no los generalices ("varias", "algunos") ni los omitas.
- **Conserva todos los nombres** de personas, clientes, empresas y lugares exactamente como aparecen, en cualquier tipo de entrada (no solo en incidencias). Si dice "Juan y Pedro instalaron la lona", la actividad dice que Juan y Pedro instalaron la lona.
- Redacta en tercera persona, en pasado y en español claro. Solo corrige ortografía, puntuación y los términos del glosario; no cambies el sentido ni quites información.
- **Ninguna entrada se queda fuera.** Toda entrada debe quedar reflejada en alguna actividad, aunque no sea trabajo de producción: incidencias, fallas de equipo, accidentes, retrasos, visitas, faltas de material o conflictos entre personal se registran igual que lo demás.
- Puedes juntar en UNA actividad varias entradas que hablen del mismo asunto, pero la descripción debe incluir los detalles de cada una (con sus horas, datos y nombres). Si dudas si es el mismo asunto, déjalas separadas.
- Cuando el orden en el tiempo importe, indica la hora en que ocurrió (la que menciona la entrada o, si no menciona ninguna, su hora de captura).
- Las incidencias se registran tal como se reportaron, sin suavizarlas ni omitirlas.
- No evalúes, no califiques, no sugieras mejoras, no asignes culpas. Solo redacta lo que pasó.
- El título nombra el asunto concreto (máx. 12 palabras) e incluye el cliente o el dato principal si lo hay.
- La conclusión cuenta el día en 3 a 5 oraciones con los datos y nombres más importantes, incluidas las incidencias.
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

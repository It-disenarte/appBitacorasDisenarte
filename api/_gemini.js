const GLOSARIO = `Contexto del negocio (Diseñarte México, rotulación y señalización):
materiales: trovicel, vinil, lona, acrílico, PVC, MDF, coroplast, laminado;
procesos: corte, router, laminado, rotulación, impresión, instalación, montaje, acabado;
equipos: plotter, impresora de gran formato, router CNC, laminadora.
Escribe estos términos correctamente aunque el audio suene distinto.`;

const MODELOS = () => [
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest'
].filter(Boolean);

/* Lee el body venga como objeto, string o stream. */
export async function leerBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function callGemini(parts, { json = false } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Falta la variable GEMINI_API_KEY en Vercel. Agrégala en Settings → Environment Variables y vuelve a desplegar.');

  let ultimo = '';
  for (const model of MODELOS()) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: json
            ? { responseMimeType: 'application/json', temperature: 0.3 }
            : { temperature: 0.2 }
        })
      }
    );
    if (r.ok) {
      const j = await r.json();
      const texto = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      if (texto) return texto;
      ultimo = `El modelo ${model} respondió vacío (${j.candidates?.[0]?.finishReason || 'sin razón'}).`;
      continue;
    }
    const cuerpo = await r.text();
    let msg = cuerpo;
    try { msg = JSON.parse(cuerpo).error?.message || cuerpo; } catch {}
    ultimo = `${model} → ${r.status}: ${msg}`;
    // 404 = modelo inexistente: probar el siguiente. Otro error: no insistir.
    if (r.status !== 404) break;
  }
  throw new Error(ultimo || 'Gemini no respondió.');
}

export { GLOSARIO, MODELOS };

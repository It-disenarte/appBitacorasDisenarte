const GLOSARIO = `Contexto del negocio (Diseñarte México, rotulación y señalización):
materiales: trovicel, vinil, lona, acrílico, PVC, MDF, coroplast, laminado;
procesos: corte, router, laminado, rotulación, impresión, instalación, montaje, acabado;
equipos: plotter, impresora de gran formato, router CNC, laminadora.
Escribe estos términos correctamente aunque el audio suene distinto.`;

const MODELOS = () => [...new Set([
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest'
].filter(Boolean))];

const espera = (ms) => new Promise(r => setTimeout(r, ms));
/* Errores temporales: vale la pena reintentar o cambiar de modelo. */
const TEMPORAL = new Set([429, 500, 502, 503, 504]);

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
    // Dos intentos por modelo: los 503 de Google suelen ser picos de segundos.
    for (let intento = 0; intento < 2; intento++) {
      if (intento) await espera(1200);
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            safetySettings: [
              'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
              'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'
            ].map(category => ({ category, threshold: 'BLOCK_NONE' })),
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
        break;
      }
      const cuerpo = await r.text();
      let msg = cuerpo;
      try { msg = JSON.parse(cuerpo).error?.message || cuerpo; } catch {}
      ultimo = `${model} → ${r.status}: ${msg}`;
      // 404: el modelo no existe con esta key. Temporal: reintentar y luego cambiar de modelo.
      if (r.status === 404) break;
      if (!TEMPORAL.has(r.status)) return Promise.reject(new Error(ultimo));
    }
  }
  throw new Error(ultimo || 'Gemini no respondió.');
}

export { GLOSARIO, MODELOS };

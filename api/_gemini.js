const GLOSARIO = `Contexto del negocio (Diseñarte México, rotulación y señalización):
materiales: trovicel, vinil, lona, acrílico, PVC, MDF, coroplast, laminado;
procesos: corte, router, laminado, rotulación, impresión, instalación, montaje, acabado;
equipos: plotter, impresora de gran formato, router CNC, laminadora.
Escribe estos términos correctamente aunque el audio suene distinto.`;

export async function callGemini(parts, { json = false } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Falta GEMINI_API_KEY');
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
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
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

export { GLOSARIO };

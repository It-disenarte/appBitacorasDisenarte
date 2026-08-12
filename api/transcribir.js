import { callGemini, GLOSARIO, leerBody } from './_gemini.js';

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { audio, mime } = await leerBody(req);
    if (!audio) return res.status(400).json({ error: 'Falta el audio' });

    const texto = await callGemini([
      { text: `Transcribe literalmente esta nota de voz en español de México. Devuelve solo la transcripción, sin comillas ni comentarios.\n\n${GLOSARIO}` },
      { inline_data: { mime_type: mime || 'audio/webm', data: audio } }
    ]);

    res.status(200).json({ texto: texto.trim() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}

/* Diagnóstico: abre /api/estado en el navegador para ver qué falta. */
import { q } from './_servidor.js';

async function baseDeDatos() {
  if (!process.env.DATABASE_URL) return 'Falta DATABASE_URL.';
  try {
    const [{ version }] = await q('SELECT version()');
    return `Conectada: ${version.split(',')[0]}`;
  } catch (e) {
    return `No conecta: ${e.message}`;
  }
}

export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  const salida = {
    baseDeDatos: await baseDeDatos(),
    tieneKey: Boolean(key),
    longitudKey: key ? key.length : 0,
    modeloConfigurado: process.env.GEMINI_MODEL || '(ninguno, se usa el automático)',
    runtime: process.version
  };
  if (!key) {
    salida.diagnostico = 'Falta GEMINI_API_KEY. Agrégala en las variables de entorno y vuelve a desplegar.';
    return res.status(200).json(salida);
  }
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const j = await r.json();
    if (!r.ok) {
      salida.diagnostico = `La key fue rechazada por Google (${r.status}): ${j.error?.message || ''}`;
      return res.status(200).json(salida);
    }
    salida.modelosDisponibles = (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
    salida.diagnostico = 'La key funciona. Usa cualquiera de los modelos listados en GEMINI_MODEL.';
  } catch (e) {
    salida.diagnostico = `No se pudo contactar a Google: ${e.message}`;
  }
  res.status(200).json(salida);
}

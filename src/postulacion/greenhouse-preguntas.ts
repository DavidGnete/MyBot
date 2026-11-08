import { z } from 'zod';
import { obtenerJson } from '../fuentes/http.js';
import type { Pregunta } from './tipos.js';

// API pública: GET /boards/{tablero}/jobs/{id}?questions=true describe el formulario exacto
const API = 'https://boards-api.greenhouse.io/v1/boards';

const esquemaCampo = z.object({
  name: z.string(),
  type: z.string(), // input_text | input_file | textarea | multi_value_single_select | multi_value_multi_select
  values: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })).nullish(),
});

const esquemaOferta = z.object({
  title: z.string(),
  language: z.string().nullish(), // "en", "es"... idioma de la oferta
  questions: z.array(z.object({ label: z.string(), required: z.boolean(), fields: z.array(esquemaCampo) })).default([]),
});

export type FormularioGreenhouse = { idioma: string | null; preguntas: Pregunta[] };

/** Ubica una oferta en Greenhouse a partir de su URL de postulación. */
export function ubicarEnGreenhouse(url: string): { tablero: string; idOferta: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)greenhouse\.io$/.test(u.hostname)) return null;

  // boards.greenhouse.io/embed/job_app?for=clara&token=123
  const porParametros = u.searchParams.get('for') && u.searchParams.get('token');
  if (porParametros) return { tablero: u.searchParams.get('for')!, idOferta: u.searchParams.get('token')! };

  // job-boards.greenhouse.io/clara/jobs/123
  const partes = u.pathname.split('/').filter(Boolean);
  if (partes.length >= 3 && partes[1] === 'jobs' && /^\d+$/.test(partes[2]!)) {
    return { tablero: partes[0]!, idOferta: partes[2]! };
  }
  return null;
}

/** Convierte una pregunta de Greenhouse (que puede tener varios campos) a nuestro formato. */
function convertir(pregunta: z.infer<typeof esquemaOferta>['questions'][number]): Pregunta | null {
  const base = { etiqueta: pregunta.label.trim(), obligatoria: pregunta.required, opciones: [] };
  const porTipo = (tipo: string) => pregunta.fields.find((f) => f.type === tipo);

  // La hoja de vida: archivo (lo llena el bot con tu PDF)
  const archivo = porTipo('input_file');
  if (archivo?.name === 'resume') return { ...base, campo: 'resume', tipo: 'archivo' };

  // Otras preguntas con archivo (ej. carta de presentación) suelen permitir texto como alternativa
  const parrafo = porTipo('textarea');
  if (parrafo) return { ...base, campo: parrafo.name, tipo: 'parrafo' };
  if (archivo) return null; // archivo sin alternativa de texto: no lo soportamos (si es obligatorio, se avisa)

  const texto = porTipo('input_text');
  if (texto) return { ...base, campo: texto.name, tipo: 'texto' };

  const seleccion = porTipo('multi_value_single_select') ?? porTipo('multi_value_multi_select');
  if (seleccion) {
    return {
      ...base,
      campo: seleccion.name,
      tipo: seleccion.type === 'multi_value_multi_select' ? 'multiple' : 'opcion',
      opciones: (seleccion.values ?? []).map((v) => ({ etiqueta: v.label, valor: String(v.value) })),
    };
  }
  return null;
}

export async function leerFormularioGreenhouse(tablero: string, idOferta: string): Promise<FormularioGreenhouse> {
  const oferta = await obtenerJson(
    `${API}/${encodeURIComponent(tablero)}/jobs/${encodeURIComponent(idOferta)}?questions=true`,
    esquemaOferta,
  );

  const preguntas: Pregunta[] = [];
  for (const original of oferta.questions) {
    const convertida = convertir(original);
    if (convertida) {
      preguntas.push(convertida);
    } else if (original.required) {
      // Mejor detenernos que enviar un formulario incompleto
      throw new Error(`El formulario pide algo que aún no sé llenar: "${original.label}"`);
    }
  }
  return { idioma: oferta.language ?? null, preguntas };
}

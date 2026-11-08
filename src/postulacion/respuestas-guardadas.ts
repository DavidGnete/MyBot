import { eq } from 'drizzle-orm';
import { db } from '../db/cliente.js';
import { respuestasGuardadas } from '../db/esquema.js';
import { normalizar } from '../busqueda/filtro.js';
import type { Pregunta } from './tipos.js';

/** "LinkedIn Profile*" y "linkedin profile" son la misma pregunta. */
export function claveDe(etiqueta: string): string {
  return normalizar(etiqueta.replace(/\*/g, ''));
}

/**
 * Los párrafos NO se reutilizan: "Why do you want to join us?" se ve igual en muchas
 * empresas, pero tu respuesta para una no sirve para otra.
 */
export function esReutilizable(pregunta: Pregunta): boolean {
  return pregunta.tipo === 'texto' || pregunta.tipo === 'opcion' || pregunta.tipo === 'multiple';
}

/** Busca una respuesta guardada que sirva para esta pregunta. */
export async function buscarRespuesta(pregunta: Pregunta): Promise<string | undefined> {
  if (!esReutilizable(pregunta)) return undefined;

  const [fila] = await db.select().from(respuestasGuardadas).where(eq(respuestasGuardadas.clave, claveDe(pregunta.etiqueta)));
  if (!fila) return undefined;

  // En preguntas de selección, la respuesta guardada debe ser una de las opciones de ESTE formulario
  if (pregunta.tipo === 'opcion') {
    return pregunta.opciones.some((o) => o.etiqueta === fila.respuesta) ? fila.respuesta : undefined;
  }
  if (pregunta.tipo === 'multiple') {
    const elegidas = fila.respuesta.split(' | ');
    return elegidas.every((e) => pregunta.opciones.some((o) => o.etiqueta === e)) ? fila.respuesta : undefined;
  }
  return fila.respuesta;
}

export async function guardarRespuesta(pregunta: Pregunta, respuesta: string): Promise<void> {
  if (!esReutilizable(pregunta)) return;
  await db
    .insert(respuestasGuardadas)
    .values({ clave: claveDe(pregunta.etiqueta), pregunta: pregunta.etiqueta, respuesta })
    .onConflictDoUpdate({ target: respuestasGuardadas.clave, set: { respuesta } });
}

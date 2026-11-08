import { db } from '../db/cliente.js';
import { fuentes } from '../db/esquema.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { TipoFuente } from './index.js';

// Fuentes que buscan tu rol en todo su sitio (no son "una empresa"):
// se activan solas, no tienes que registrarlas.
const PREDETERMINADAS: { tipo: TipoFuente; nombre: string; requiere?: () => boolean }[] = [
  { tipo: 'getonboard', nombre: 'Get on Board' },
  { tipo: 'himalayas', nombre: 'Himalayas' },
  { tipo: 'remoteok', nombre: 'Remote OK' },
  { tipo: 'remotive', nombre: 'Remotive' },
  { tipo: 'jooble', nombre: 'Jooble', requiere: () => Boolean(config.JOOBLE_API_KEY) }, // solo si hay key
];

/**
 * Se llama al arrancar. Crea las fuentes predeterminadas si no existen.
 * onConflictDoNothing: si ya existen NO las toca, así que si desactivaste
 * una con /quitar, se queda desactivada (respetamos tu decisión).
 */
export async function asegurarFuentesPredeterminadas(): Promise<void> {
  const disponibles = PREDETERMINADAS.filter((f) => !f.requiere || f.requiere());
  const creadas = await db
    .insert(fuentes)
    .values(disponibles.map(({ tipo, nombre }) => ({ tipo, nombre, identificador: 'global' })))
    .onConflictDoNothing({ target: [fuentes.tipo, fuentes.identificador] })
    .returning({ nombre: fuentes.nombre });

  if (creadas.length > 0) logger.info({ fuentes: creadas.map((f) => f.nombre) }, 'Fuentes predeterminadas activadas');
}

import { db } from '../db/cliente.js';
import { fuentes } from '../db/esquema.js';
import { logger } from '../logger.js';
import type { TipoFuente } from './index.js';

// Fuentes que buscan tu rol en todo su sitio (no son "una empresa"):
// se activan solas, no tienes que registrarlas.
const PREDETERMINADAS: { tipo: TipoFuente; nombre: string }[] = [
  { tipo: 'himalayas', nombre: 'Himalayas' },
  { tipo: 'remoteok', nombre: 'Remote OK' },
  { tipo: 'remotive', nombre: 'Remotive' },
];

/**
 * Se llama al arrancar. Crea las fuentes predeterminadas si no existen.
 * onConflictDoNothing: si ya existen NO las toca, así que si desactivaste
 * una con /quitar, se queda desactivada (respetamos tu decisión).
 */
export async function asegurarFuentesPredeterminadas(): Promise<void> {
  const creadas = await db
    .insert(fuentes)
    .values(PREDETERMINADAS.map((f) => ({ ...f, identificador: 'global' })))
    .onConflictDoNothing({ target: [fuentes.tipo, fuentes.identificador] })
    .returning({ nombre: fuentes.nombre });

  if (creadas.length > 0) logger.info({ fuentes: creadas.map((f) => f.nombre) }, 'Fuentes predeterminadas activadas');
}

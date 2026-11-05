import { eq } from 'drizzle-orm';
import { db } from './db/cliente.js';
import { ajustes } from './db/esquema.js';

// Las claves posibles quedan fijadas aquí: un error de escritura no compila.
export type ClaveAjuste = 'rol';

export async function obtenerAjuste(clave: ClaveAjuste): Promise<string | undefined> {
  const [fila] = await db.select().from(ajustes).where(eq(ajustes.clave, clave));
  return fila?.valor;
}

/** Inserta o actualiza ("upsert"): si la clave ya existe, reemplaza su valor. */
export async function guardarAjuste(clave: ClaveAjuste, valor: string): Promise<void> {
  await db
    .insert(ajustes)
    .values({ clave, valor })
    .onConflictDoUpdate({ target: ajustes.clave, set: { valor } });
}

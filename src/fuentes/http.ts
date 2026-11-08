import type { z } from 'zod';
import { ErrorFuente } from './tipos.js';

/**
 * GET a una API pública + validación con Zod.
 * Validamos porque son datos EXTERNOS: si el sitio cambia su formato, preferimos
 * un error claro aquí que datos corruptos en la base de datos.
 */
export async function obtenerJson<T extends z.ZodType>(url: string, esquema: T): Promise<z.infer<T>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      // Nos identificamos con un nombre honesto (algunas APIs bloquean peticiones sin User-Agent)
      headers: { Accept: 'application/json', 'User-Agent': 'agente-empleo/0.1 (uso personal)' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ErrorFuente(`No se pudo conectar a ${new URL(url).host}: ${(error as Error).message}`);
  }

  if (respuesta.status === 404) throw new ErrorFuente('No existe (404): revisa el nombre de la empresa en el link');
  if (!respuesta.ok) throw new ErrorFuente(`${new URL(url).host} respondió HTTP ${respuesta.status}`);

  const resultado = esquema.safeParse(await respuesta.json());
  if (!resultado.success) {
    throw new ErrorFuente(`${new URL(url).host} devolvió un formato inesperado: ${resultado.error.issues[0]?.message}`);
  }
  return resultado.data;
}

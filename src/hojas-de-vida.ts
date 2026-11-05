import { stat } from 'node:fs/promises';

export type Idioma = 'es' | 'en';

export const IDIOMAS: Record<Idioma, string> = { es: 'Español', en: 'Inglés' };

/** Ruta fija de cada hoja de vida. La carpeta datos/ no se sube a git. */
export function rutaHojaDeVida(idioma: Idioma): string {
  return `datos/cv-${idioma}.pdf`;
}

/** Devuelve la fecha de la última actualización de cada PDF, o null si no existe. */
export async function estadoHojasDeVida(): Promise<Record<Idioma, Date | null>> {
  const estado = { es: null, en: null } as Record<Idioma, Date | null>;
  for (const idioma of Object.keys(IDIOMAS) as Idioma[]) {
    try {
      estado[idioma] = (await stat(rutaHojaDeVida(idioma))).mtime;
    } catch {
      // no existe todavía
    }
  }
  return estado;
}

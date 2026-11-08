import { z } from 'zod';
import { obtenerJson } from './http.js';
import { separarLista } from '../busqueda/filtro.js';
import type { LectorFuente, OfertaLeida } from './tipos.js';

// API pública de Himalayas: https://himalayas.app/docs/remote-jobs-api
// Términos: postular SIEMPRE por el applicationLink que entregan y dar crédito a Himalayas.
const API = 'https://himalayas.app/jobs/api/search';
const MAXIMO_ALTERNATIVAS = 5; // una consulta por alternativa del rol: no abusar

const esquema = z.object({
  totalCount: z.number().nullish(),
  jobs: z.array(
    z.object({
      guid: z.string(),
      title: z.string(),
      companyName: z.string(),
      locationRestrictions: z.array(z.string()).nullish(),
      applicationLink: z.url(),
      pubDate: z.number().nullish(), // segundos desde 1970
    }),
  ),
});

/** Las restricciones pueden ser listas de 100+ países: las resumimos. */
function resumirUbicacion(paises: string[] | null | undefined, pais: string | undefined): string {
  if (!paises || paises.length === 0) return 'Remoto: cualquier país';
  if (pais && paises.some((p) => p.toLowerCase() === pais.toLowerCase())) return `Remoto (acepta ${pais})`;
  return `Remoto: ${paises.slice(0, 3).join(', ')}${paises.length > 3 ? '…' : ''}`;
}

export const himalayas: LectorFuente = {
  esperaMinimaMinutos: 5,

  async verificar() {
    const { totalCount, jobs } = await obtenerJson(`${API}?q=developer`, esquema);
    return { nombre: 'Himalayas', totalOfertas: totalCount ?? jobs.length };
  },

  // Himalayas SÍ busca: una consulta por cada alternativa del rol (y por país, si lo definiste)
  async leerOfertas(_fuente, { rol, pais }) {
    const porId = new Map<string, OfertaLeida>();

    for (const alternativa of separarLista(rol).slice(0, MAXIMO_ALTERNATIVAS)) {
      const parametros = new URLSearchParams({ q: alternativa });
      if (pais) parametros.set('country', pais);
      const { jobs } = await obtenerJson(`${API}?${parametros}`, esquema);

      for (const job of jobs) {
        porId.set(job.guid, {
          idExterno: job.guid,
          titulo: job.title,
          empresa: job.companyName,
          ubicacion: resumirUbicacion(job.locationRestrictions, pais),
          url: job.applicationLink,
          publicadaEn: job.pubDate ? new Date(job.pubDate * 1000) : null,
          datosCrudos: { urlPostulacion: job.applicationLink },
        });
      }
    }
    return [...porId.values()]; // el Map elimina repetidas entre alternativas
  },
};

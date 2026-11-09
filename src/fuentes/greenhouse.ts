import { z } from 'zod';
import { obtenerJson } from './http.js';
import type { LectorFuente, OfertaLeida } from './tipos.js';

// API pública de Greenhouse (sin key): https://developers.greenhouse.io/job-board.html
const API = 'https://boards-api.greenhouse.io/v1/boards';

// Solo declaramos los campos que usamos; z.object ignora el resto.
const esquemaTablero = z.object({ name: z.string() });

const esquemaOfertas = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.url(),
      company_name: z.string().nullish(),
      location: z.object({ name: z.string() }).nullish(),
      first_published: z.string().nullish(),
      updated_at: z.string(),
    }),
  ),
});

export const greenhouse: LectorFuente = {
  esperaMinimaMinutos: 5,

  async verificar(identificador) {
    const tablero = await obtenerJson(`${API}/${encodeURIComponent(identificador)}`, esquemaTablero);
    const { jobs } = await obtenerJson(`${API}/${encodeURIComponent(identificador)}/jobs`, esquemaOfertas);
    return { nombre: tablero.name.trim(), totalOfertas: jobs.length };
  },

  async leerOfertas({ identificador, nombre }) {
    const { jobs } = await obtenerJson(`${API}/${encodeURIComponent(identificador)}/jobs`, esquemaOfertas);
    return jobs.map(
      (job): OfertaLeida => ({
        idExterno: String(job.id),
        titulo: job.title,
        empresa: (job.company_name ?? nombre).trim(),
        ubicacion: job.location?.name ?? null,
        url: job.absolute_url,
        publicadaEn: new Date(job.first_published ?? job.updated_at),
        datosCrudos: { urlPostulacion: job.absolute_url, tablero: identificador },
      }),
    );
  },
};

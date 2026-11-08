import { z } from 'zod';
import { obtenerJson } from './http.js';
import type { LectorFuente, OfertaLeida } from './tipos.js';

// API pública de Remotive: https://remotive.com/api-documentation
// Términos: enlazar a la oferta EN Remotive y mencionar a Remotive como fuente;
// consultar solo unas pocas veces al día. Su API pública muestra pocas ofertas (las más recientes).
const API = 'https://remotive.com/api/remote-jobs';

const esquema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      url: z.url(),
      title: z.string(),
      company_name: z.string(),
      candidate_required_location: z.string().nullish(),
      publication_date: z.string().nullish(),
    }),
  ),
});

export const remotive: LectorFuente = {
  esperaMinimaMinutos: 6 * 60, // sus términos: máximo ~4 consultas al día

  async verificar() {
    const { jobs } = await obtenerJson(API, esquema);
    return { nombre: 'Remotive', totalOfertas: jobs.length };
  },

  // Son pocas ofertas: traemos todas y el buscador filtra por rol localmente
  async leerOfertas() {
    const { jobs } = await obtenerJson(API, esquema);
    return jobs.map(
      (job): OfertaLeida => ({
        idExterno: String(job.id),
        titulo: job.title,
        empresa: job.company_name,
        ubicacion: job.candidate_required_location ? `Remoto: ${job.candidate_required_location}` : 'Remoto',
        url: job.url,
        publicadaEn: job.publication_date ? new Date(`${job.publication_date}Z`) : null,
        datosCrudos: { urlPostulacion: job.url },
      }),
    );
  },
};

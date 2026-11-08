import { z } from 'zod';
import { config } from '../config.js';
import { separarLista } from '../busqueda/filtro.js';
import { ErrorFuente, type LectorFuente, type OfertaLeida } from './tipos.js';

// API de Jooble (key gratuita): POST https://<sitio>/api/{key} con { keywords, location, page }.
// La key pertenece al sitio del país donde la registraste (comprobado: una key de
// co.jooble.org responde 403 en jooble.org y viceversa). El sitio se define en JOOBLE_SITIO.
const API = `https://${config.JOOBLE_SITIO}/api`;
const MAXIMO_ALTERNATIVAS = 5;

const esquema = z.object({
  totalCount: z.number().nullish(),
  jobs: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      title: z.string(),
      company: z.string().nullish(),
      location: z.string().nullish(),
      link: z.url(),
      source: z.string().nullish(), // de qué sitio viene la oferta
      updated: z.string().nullish(),
    }),
  ),
});

async function buscar(clave: string, cuerpo: Record<string, string>) {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${API}/${clave}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ErrorFuente(`No se pudo conectar a Jooble: ${(error as Error).message}`);
  }
  // Nunca incluimos la URL en el error: lleva la key
  if (respuesta.status === 403 || respuesta.status === 401) {
    throw new ErrorFuente(`Jooble rechazó la key: revisa JOOBLE_API_KEY y que JOOBLE_SITIO (${config.JOOBLE_SITIO}) sea el sitio donde la registraste`);
  }
  if (!respuesta.ok) throw new ErrorFuente(`Jooble respondió HTTP ${respuesta.status}`);
  const resultado = esquema.safeParse(await respuesta.json());
  if (!resultado.success) throw new ErrorFuente('Jooble devolvió un formato inesperado');
  return resultado.data;
}

function requerirClave(): string {
  if (!config.JOOBLE_API_KEY) throw new ErrorFuente('Falta JOOBLE_API_KEY en .env');
  return config.JOOBLE_API_KEY;
}

export const jooble: LectorFuente = {
  esperaMinimaMinutos: 60, // la key gratuita tiene cuota limitada: como máximo una lectura por hora

  async verificar() {
    const { totalCount, jobs } = await buscar(requerirClave(), { keywords: 'developer' });
    return { nombre: 'Jooble', totalOfertas: totalCount ?? jobs.length };
  },

  async leerOfertas(_fuente, { rol, pais }) {
    const clave = requerirClave();
    const porId = new Map<string, OfertaLeida>();

    for (const alternativa of separarLista(rol).slice(0, MAXIMO_ALTERNATIVAS)) {
      const { jobs } = await buscar(clave, { keywords: alternativa, ...(pais && { location: pais }), page: '1' });
      for (const job of jobs) {
        porId.set(String(job.id), {
          idExterno: String(job.id),
          titulo: job.title,
          empresa: job.company || job.source || 'Empresa en Jooble',
          ubicacion: job.location || null,
          url: job.link, // enlace de Jooble que redirige a la oferta original
          publicadaEn: job.updated ? new Date(job.updated) : null,
          datosCrudos: { urlPostulacion: job.link, sitioOriginal: job.source ?? null },
        });
      }
    }
    return [...porId.values()];
  },
};

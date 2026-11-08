import { z } from 'zod';
import { obtenerJson } from './http.js';
import { codigoPais } from './paises.js';
import { separarLista } from '../busqueda/filtro.js';
import type { LectorFuente, OfertaLeida } from './tipos.js';

// API pública de Get on Board (sin key para buscar): https://getonbrd.com/api-doc.html
// Parámetros según su OpenAPI: query, country_code, remote, page, per_page, expand.
const API = 'https://www.getonbrd.com/api/v0/search/jobs';
const MAXIMO_ALTERNATIVAS = 5;
const MAXIMO_PAGINAS = 3; // 20 ofertas por página

const esquema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      attributes: z.object({
        title: z.string(),
        countries: z.array(z.string()).nullish(),
        remote_modality: z.string().nullish(), // fully_remote | remote_local | hybrid | no_remote
        published_at: z.number().nullish(), // segundos desde 1970
        company: z.object({ data: z.object({ attributes: z.object({ name: z.string() }) }) }).nullish(),
      }),
      links: z.object({ public_url: z.url() }),
    }),
  ),
  meta: z.object({ total_pages: z.number() }).nullish(),
});

const MODALIDAD: Record<string, string> = {
  fully_remote: 'Remoto',
  remote_local: 'Remoto (zona)',
  hybrid: 'Híbrido',
  no_remote: 'Presencial',
};

function ubicacion(a: z.infer<typeof esquema>['data'][number]['attributes']): string {
  const modo = MODALIDAD[a.remote_modality ?? ''] ?? '';
  const paises = (a.countries ?? []).filter((p) => p !== 'Remote').join(', ');
  return [modo, paises].filter(Boolean).join(': ') || 'Sin especificar';
}

export const getonboard: LectorFuente = {
  esperaMinimaMinutos: 5,

  async verificar() {
    const { data } = await obtenerJson(`${API}?query=developer&per_page=20`, esquema);
    return { nombre: 'Get on Board', totalOfertas: data.length };
  },

  // Busca cada alternativa del rol, en tu país (country_code) si lo definiste con /pais
  async leerOfertas(_fuente, { rol, pais }) {
    const porId = new Map<string, OfertaLeida>();
    const codigo = codigoPais(pais);

    for (const alternativa of separarLista(rol).slice(0, MAXIMO_ALTERNATIVAS)) {
      for (let pagina = 1; pagina <= MAXIMO_PAGINAS; pagina++) {
        const parametros = new URLSearchParams({ query: alternativa, per_page: '20', page: String(pagina), expand: '["company"]' });
        if (codigo) parametros.set('country_code', codigo);
        const { data, meta } = await obtenerJson(`${API}?${parametros}`, esquema);

        for (const oferta of data) {
          const a = oferta.attributes;
          porId.set(oferta.id, {
            idExterno: oferta.id,
            titulo: a.title,
            empresa: a.company?.data.attributes.name ?? 'Empresa en Get on Board',
            ubicacion: ubicacion(a),
            url: oferta.links.public_url,
            publicadaEn: a.published_at ? new Date(a.published_at * 1000) : null,
            datosCrudos: { urlPostulacion: oferta.links.public_url },
          });
        }
        if (!meta || pagina >= meta.total_pages) break;
      }
    }
    return [...porId.values()];
  },
};

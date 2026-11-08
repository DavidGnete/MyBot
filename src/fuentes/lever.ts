import { z } from 'zod';
import { obtenerJson } from './http.js';
import type { LectorFuente, OfertaLeida } from './tipos.js';

// API pública de Lever (sin key): https://github.com/lever/postings-api
const API = 'https://api.lever.co/v0/postings';

const esquemaOfertas = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.url(),
    applyUrl: z.url(),
    createdAt: z.number(), // milisegundos desde 1970
    workplaceType: z.string().nullish(), // "remote" | "hybrid" | "on-site" | "unspecified"
    categories: z
      .object({ location: z.string().nullish(), commitment: z.string().nullish() })
      .nullish(),
  }),
);

/** Lever no expone el nombre de la empresa: lo derivamos del identificador ("acme-corp" -> "Acme Corp"). */
function nombreDesdeIdentificador(identificador: string): string {
  return identificador.split(/[-_]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function ubicacion(oferta: z.infer<typeof esquemaOfertas>[number]): string | null {
  const lugar = oferta.categories?.location ?? null;
  if (oferta.workplaceType === 'remote') return lugar ? `${lugar} (remoto)` : 'Remoto';
  return lugar;
}

export const lever: LectorFuente = {
  esperaMinimaMinutos: 5,

  async verificar(identificador) {
    const ofertas = await obtenerJson(`${API}/${encodeURIComponent(identificador)}?mode=json`, esquemaOfertas);
    return { nombre: nombreDesdeIdentificador(identificador), totalOfertas: ofertas.length };
  },

  async leerOfertas({ identificador, nombre }) {
    const ofertas = await obtenerJson(`${API}/${encodeURIComponent(identificador)}?mode=json`, esquemaOfertas);
    return ofertas.map(
      (oferta): OfertaLeida => ({
        idExterno: oferta.id,
        titulo: oferta.text,
        empresa: nombre,
        ubicacion: ubicacion(oferta),
        url: oferta.hostedUrl,
        publicadaEn: new Date(oferta.createdAt),
        datosCrudos: { urlPostulacion: oferta.applyUrl, modalidad: oferta.workplaceType ?? null },
      }),
    );
  },
};

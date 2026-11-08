import { z } from 'zod';
import { obtenerJson } from './http.js';
import type { LectorFuente, OfertaLeida } from './tipos.js';

// API pública de Remote OK: https://remoteok.com/api
// Términos (vienen en la propia respuesta): enlazar a la URL de la oferta EN Remote OK
// y mencionar "Remote OK" como fuente. Devuelve las ~100 ofertas más recientes.
const API = 'https://remoteok.com/api';

const esquemaOferta = z.object({
  id: z.union([z.string(), z.number()]),
  position: z.string(),
  company: z.string(),
  location: z.string().nullish(),
  url: z.url(),
  apply_url: z.url().nullish(),
  epoch: z.number().nullish(),
});

/** El primer elemento del arreglo es un aviso legal, no una oferta: nos quedamos solo con las ofertas. */
async function leerTodas() {
  const elementos = await obtenerJson(API, z.array(z.unknown()));
  return elementos.flatMap((elemento) => {
    const resultado = esquemaOferta.safeParse(elemento);
    return resultado.success ? [resultado.data] : [];
  });
}

export const remoteok: LectorFuente = {
  esperaMinimaMinutos: 5,

  async verificar() {
    return { nombre: 'Remote OK', totalOfertas: (await leerTodas()).length };
  },

  async leerOfertas() {
    return (await leerTodas()).map(
      (oferta): OfertaLeida => ({
        idExterno: String(oferta.id),
        titulo: oferta.position,
        empresa: oferta.company,
        ubicacion: oferta.location ? `Remoto: ${oferta.location}` : 'Remoto',
        url: oferta.url,
        publicadaEn: oferta.epoch ? new Date(oferta.epoch * 1000) : null,
        datosCrudos: { urlPostulacion: oferta.apply_url ?? oferta.url },
      }),
    );
  },
};

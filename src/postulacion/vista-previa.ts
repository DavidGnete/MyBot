import { mkdir } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { db } from '../db/cliente.js';
import { fuentes, ofertas, postulaciones } from '../db/esquema.js';
import { obtenerAjuste } from '../ajustes.js';
import { leerFormularioGreenhouse } from './greenhouse-preguntas.js';
import { llenarGreenhouse, urlFormularioGreenhouse } from './llenar-greenhouse.js';
import { bloquearEnvios, conNavegador } from './navegador.js';
import { ErrorPostulacion, ubicar } from './preparar.js';

export type VistaPrevia = {
  rutaCaptura: string;
  hojaDeVida: string | null; // el PDF que se adjuntará al aprobar (ej. "datos/cv-en.pdf")
  faltantes: string[];
  titulo: string;
  empresa: string;
  ofertaId: number;
};

/**
 * Fase 4b: abre el formulario, lo llena con tus respuestas y toma una captura.
 * MODO SOLO LECTURA: se bloquea toda petición que no sea GET, así que no se sube
 * el PDF ni se envía nada, pase lo que pase.
 */
export async function generarVistaPrevia(postulacionId: number): Promise<VistaPrevia> {
  const [fila] = await db
    .select({ postulacion: postulaciones, oferta: ofertas, fuente: fuentes })
    .from(postulaciones)
    .innerJoin(ofertas, eq(ofertas.id, postulaciones.ofertaId))
    .innerJoin(fuentes, eq(fuentes.id, ofertas.fuenteId))
    .where(eq(postulaciones.id, postulacionId));
  if (!fila) throw new ErrorPostulacion(`No existe la postulación ${postulacionId}.`);

  const { postulacion, oferta, fuente } = fila;
  if (postulacion.estado !== 'en_progreso') {
    throw new ErrorPostulacion(`Esta postulación no está lista para llenar (estado: ${postulacion.estado}).`);
  }
  const ubicacion = ubicar(oferta, fuente);
  if (!ubicacion) throw new ErrorPostulacion('Esta oferta no es de Greenhouse.');

  // Releemos el formulario: nos da el tipo de cada campo y detecta si la empresa lo cambió
  const formulario = await leerFormularioGreenhouse(ubicacion.tablero, ubicacion.idOferta);
  const paisTelefono = (await obtenerAjuste('pais')) || undefined;

  await mkdir('capturas', { recursive: true });
  const rutaCaptura = `capturas/vista-previa-${postulacionId}.png`;

  const { faltantes } = await conNavegador(async (pagina) => {
    await bloquearEnvios(pagina);
    await pagina.goto(urlFormularioGreenhouse(ubicacion.tablero, ubicacion.idOferta), { waitUntil: 'domcontentloaded' });
    const resultado = await llenarGreenhouse(pagina, formulario.preguntas, postulacion.respuestas, {
      subirCv: false,
      paisTelefono,
    });
    // Captura solo del formulario (no de toda la descripción de la oferta)
    await pagina.locator('form').first().screenshot({ path: rutaCaptura });
    return resultado;
  });

  await db.update(postulaciones).set({ rutaCaptura }).where(eq(postulaciones.id, postulacionId));
  const hojaDeVida = postulacion.respuestas.find((r) => r.origen === 'automatica')?.respuesta ?? null;
  return { rutaCaptura, hojaDeVida, faltantes, titulo: oferta.titulo, empresa: oferta.empresa, ofertaId: oferta.id };
}

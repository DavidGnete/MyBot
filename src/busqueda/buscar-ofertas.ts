import { eq } from 'drizzle-orm';
import { db } from '../db/cliente.js';
import { fuentes, ofertas } from '../db/esquema.js';
import { obtenerAjuste } from '../ajustes.js';
import { LECTORES, type TipoFuente } from '../fuentes/index.js';
import { ErrorFuente } from '../fuentes/tipos.js';
import { coincideConRol } from './filtro.js';
import { esAutomatizable } from '../postulacion/preparar.js';
import { logger } from '../logger.js';

export type OfertaNueva = {
  id: number;
  titulo: string;
  empresa: string;
  ubicacion: string | null;
  url: string;
  fuente: string;
  automatizable: boolean; // ¿el bot sabe llenar su formulario?
};

export type ResultadoBusqueda =
  | { estado: 'sin-rol' }
  | { estado: 'sin-fuentes' }
  | {
      estado: 'ok';
      rol: string;
      fuentesRevisadas: number;
      fuentesEnEspera: { nombre: string; minutosRestantes: number }[]; // se revisaron hace poco
      ofertasLeidas: number;
      coincidencias: number;
      nuevas: OfertaNueva[];
      errores: { fuente: string; mensaje: string }[];
    };

const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));
const MINUTO = 60 * 1000;

/**
 * Revisa todas las fuentes activas y guarda las ofertas nuevas que coinciden con el rol.
 * Solo se guardan las que coinciden: si cambias el rol, la próxima búsqueda encontrará
 * las que ahora sí coinciden (y el índice único sigue evitando duplicados).
 */
export async function buscarOfertas(): Promise<ResultadoBusqueda> {
  const [rol, excluir, pais] = await Promise.all([obtenerAjuste('rol'), obtenerAjuste('excluir'), obtenerAjuste('pais')]);
  if (!rol) return { estado: 'sin-rol' };

  const activas = await db.select().from(fuentes).where(eq(fuentes.activa, true));
  if (activas.length === 0) return { estado: 'sin-fuentes' };

  const resultado = {
    estado: 'ok' as const,
    rol,
    fuentesRevisadas: 0,
    fuentesEnEspera: [] as { nombre: string; minutosRestantes: number }[],
    ofertasLeidas: 0,
    coincidencias: 0,
    nuevas: [] as OfertaNueva[],
    errores: [] as { fuente: string; mensaje: string }[],
  };

  for (const fuente of activas) {
    const lector = LECTORES[fuente.tipo as TipoFuente];
    if (!lector) continue; // tipo sin lector (ej. "correo"): todavía no implementado

    // Respetar la espera mínima de cada API, incluso en /buscar. Solo es larga donde
    // los términos lo exigen (Remotive: 6 h); en el resto son 5 min, así que cambiar
    // de rol y volver a buscar funciona de inmediato.
    const proximaRevision = (fuente.revisadaEn?.getTime() ?? 0) + lector.esperaMinimaMinutos * MINUTO;
    if (Date.now() < proximaRevision) {
      resultado.fuentesEnEspera.push({
        nombre: fuente.nombre,
        minutosRestantes: Math.ceil((proximaRevision - Date.now()) / MINUTO),
      });
      continue;
    }

    // Cada fuente se maneja por separado: si una falla, las demás siguen.
    try {
      const leidas = await lector.leerOfertas(fuente, { rol, pais: pais || undefined });
      const coinciden = leidas.filter((oferta) => coincideConRol(oferta.titulo, rol, excluir));
      resultado.fuentesRevisadas++;
      resultado.ofertasLeidas += leidas.length;
      resultado.coincidencias += coinciden.length;

      if (coinciden.length > 0) {
        // onConflictDoNothing: si (fuente, id externo) ya existe, Postgres la ignora.
        // returning() devuelve SOLO las que se insertaron: esas son las nuevas.
        const insertadas = await db
          .insert(ofertas)
          .values(coinciden.map((oferta) => ({ ...oferta, fuenteId: fuente.id })))
          .onConflictDoNothing({ target: [ofertas.fuenteId, ofertas.idExterno] })
          .returning({
            id: ofertas.id,
            titulo: ofertas.titulo,
            empresa: ofertas.empresa,
            ubicacion: ofertas.ubicacion,
            url: ofertas.url,
            idExterno: ofertas.idExterno,
            datosCrudos: ofertas.datosCrudos,
          });
        resultado.nuevas.push(
          ...insertadas.map(({ idExterno, datosCrudos, ...oferta }) => ({
            ...oferta,
            fuente: fuente.nombre,
            automatizable: esAutomatizable({ idExterno, datosCrudos, url: oferta.url }, fuente),
          })),
        );
      }

      await db.update(fuentes).set({ revisadaEn: new Date() }).where(eq(fuentes.id, fuente.id));
      logger.info({ fuente: fuente.nombre, leidas: leidas.length, coinciden: coinciden.length }, 'Fuente revisada');
    } catch (error) {
      const mensaje = error instanceof ErrorFuente ? error.message : 'error inesperado (ver logs)';
      logger.error({ err: error, fuente: fuente.nombre }, 'No se pudo revisar la fuente');
      resultado.errores.push({ fuente: fuente.nombre, mensaje });
    }

    await pausa(1000); // ser amables con los servidores ajenos
  }

  return resultado;
}

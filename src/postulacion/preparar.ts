import { and, eq } from 'drizzle-orm';
import { db } from '../db/cliente.js';
import { fuentes, ofertas, postulaciones } from '../db/esquema.js';
import { estadoHojasDeVida, rutaHojaDeVida, type Idioma } from '../hojas-de-vida.js';
import { leerFormularioGreenhouse, ubicarEnGreenhouse } from './greenhouse-preguntas.js';
import { buscarRespuesta, guardarRespuesta } from './respuestas-guardadas.js';
import type { Pregunta, Respuesta } from './tipos.js';
import { normalizar } from '../busqueda/filtro.js';

export class ErrorPostulacion extends Error {}

export type Avance =
  | { tipo: 'preguntar'; postulacionId: number; pregunta: Pregunta; numero: number; total: number; empresa: string }
  | { tipo: 'completa'; postulacionId: number; reutilizadas: number; tuyas: number; empresa: string; titulo: string };

const LIMITE = { texto: 255, parrafo: 10_000 }; // Greenhouse corta los campos de una línea en 255

// Solo los datos necesarios: así sirve tanto con filas completas como con resultados parciales
type DatosOferta = Pick<typeof ofertas.$inferSelect, 'idExterno' | 'url' | 'datosCrudos'>;
type DatosFuente = Pick<typeof fuentes.$inferSelect, 'tipo' | 'identificador'>;

/** Dónde está el formulario de la oferta en Greenhouse (o null si no es de Greenhouse). */
export function ubicar(oferta: DatosOferta, fuente: DatosFuente) {
  if (fuente.tipo === 'greenhouse') return { tablero: fuente.identificador, idOferta: oferta.idExterno };
  const datos = oferta.datosCrudos as { urlPostulacion?: string } | null;
  return ubicarEnGreenhouse(datos?.urlPostulacion ?? oferta.url);
}

/** ¿Se puede postular automáticamente? (sin llamar a ninguna API) */
export function esAutomatizable(oferta: DatosOferta, fuente: DatosFuente): boolean {
  return ubicar(oferta, fuente) !== null;
}

/** Elige la hoja de vida según el idioma de la oferta; si no la tienes en ese idioma, usa la otra. */
export async function elegirHojaDeVida(idiomaOferta: string | null): Promise<Idioma> {
  const disponibles = await estadoHojasDeVida();
  const preferido: Idioma = idiomaOferta?.startsWith('es') ? 'es' : 'en';
  const alterno: Idioma = preferido === 'es' ? 'en' : 'es';
  if (disponibles[preferido]) return preferido;
  if (disponibles[alterno]) return alterno;
  throw new ErrorPostulacion('No tienes ninguna hoja de vida guardada. Envíame tu PDF primero.');
}

export async function postulacionActiva() {
  const [activa] = await db.select().from(postulaciones).where(eq(postulaciones.estado, 'pendiente')).limit(1);
  return activa;
}

async function avance(postulacionId: number): Promise<Avance> {
  const [fila] = await db
    .select({ p: postulaciones, empresa: ofertas.empresa, titulo: ofertas.titulo })
    .from(postulaciones)
    .innerJoin(ofertas, eq(ofertas.id, postulaciones.ofertaId))
    .where(eq(postulaciones.id, postulacionId));
  if (!fila) throw new ErrorPostulacion('La postulación ya no existe.');

  const { p, empresa, titulo } = fila;
  const [siguiente] = p.preguntasPendientes;
  if (siguiente) {
    const respondidasPorTi = p.respuestas.filter((r) => r.origen === 'tuya').length;
    return {
      tipo: 'preguntar',
      postulacionId: p.id,
      pregunta: siguiente,
      numero: respondidasPorTi + 1,
      total: respondidasPorTi + p.preguntasPendientes.length,
      empresa,
    };
  }
  return {
    tipo: 'completa',
    postulacionId: p.id,
    reutilizadas: p.respuestas.filter((r) => r.origen === 'guardada').length,
    tuyas: p.respuestas.filter((r) => r.origen === 'tuya').length,
    empresa,
    titulo,
  };
}

/**
 * Empieza una postulación: lee el formulario, responde lo que ya sabe y deja en cola
 * lo que hay que preguntarte. Solo una postulación pide respuestas a la vez.
 */
export async function iniciarPostulacion(ofertaId: number): Promise<Avance | { tipo: 'manual'; url: string }> {
  const [fila] = await db
    .select({ oferta: ofertas, fuente: fuentes })
    .from(ofertas)
    .innerJoin(fuentes, eq(fuentes.id, ofertas.fuenteId))
    .where(eq(ofertas.id, ofertaId));
  if (!fila) throw new ErrorPostulacion(`No existe la oferta ${ofertaId}. Mira las disponibles con /ofertas`);
  const { oferta, fuente } = fila;

  // Si ya existe, la RETOMAMOS en vez de dar error:
  //  - pendiente   -> te repite la pregunta que falta
  //  - en_progreso -> "completa": se genera la vista previa con los botones [Enviar]/[Cancelar]
  const [existente] = await db.select().from(postulaciones).where(eq(postulaciones.ofertaId, ofertaId));
  if (existente?.estado === 'pendiente' || existente?.estado === 'en_progreso') return avance(existente.id);
  if (existente?.estado === 'enviada') throw new ErrorPostulacion('Ya enviaste esta postulación ✅. No se puede enviar dos veces.');
  if (existente?.estado === 'error') {
    // Un intento anterior no se confirmó: lo dejamos listo para reintentar (con tus mismas respuestas)
    await db.update(postulaciones).set({ estado: 'en_progreso', error: null }).where(eq(postulaciones.id, existente.id));
    await db.update(ofertas).set({ estado: 'apta' }).where(eq(ofertas.id, ofertaId));
    return avance(existente.id);
  }

  const activa = await postulacionActiva();
  if (activa) throw new ErrorPostulacion('Ya te estoy haciendo preguntas de otra oferta. Respóndelas o usa /saltar.');

  const ubicacion = ubicar(oferta, fuente);
  if (!ubicacion) {
    await db.update(ofertas).set({ estado: 'manual' }).where(eq(ofertas.id, ofertaId));
    return { tipo: 'manual', url: oferta.url };
  }

  const formulario = await leerFormularioGreenhouse(ubicacion.tablero, ubicacion.idOferta);
  const idiomaCv = await elegirHojaDeVida(formulario.idioma);

  const respuestas: Respuesta[] = [];
  const pendientes: Pregunta[] = [];
  for (const pregunta of formulario.preguntas) {
    if (pregunta.tipo === 'archivo') {
      respuestas.push({ campo: pregunta.campo, pregunta: pregunta.etiqueta, respuesta: rutaHojaDeVida(idiomaCv), origen: 'automatica' });
      continue;
    }
    const guardada = await buscarRespuesta(pregunta);
    if (guardada !== undefined) {
      respuestas.push({ campo: pregunta.campo, pregunta: pregunta.etiqueta, respuesta: guardada, origen: 'guardada' });
    } else if (pregunta.obligatoria) {
      pendientes.push(pregunta); // las opcionales sin respuesta guardada se dejan vacías
    }
  }

  const [creada] = await db
    .insert(postulaciones)
    .values({ ofertaId, idiomaCv, respuestas, preguntasPendientes: pendientes, estado: pendientes.length ? 'pendiente' : 'en_progreso' })
    .returning({ id: postulaciones.id });
  await db.update(ofertas).set({ estado: pendientes.length ? 'pendiente' : 'apta' }).where(eq(ofertas.id, ofertaId));

  return avance(creada!.id);
}

/** Valida tu respuesta para la pregunta actual, la guarda y devuelve lo siguiente. */
export async function responder(postulacionId: number, entrada: string): Promise<Avance> {
  const [p] = await db
    .select()
    .from(postulaciones)
    .where(and(eq(postulaciones.id, postulacionId), eq(postulaciones.estado, 'pendiente')));
  const pregunta = p?.preguntasPendientes[0];
  if (!p || !pregunta) throw new ErrorPostulacion('No hay ninguna pregunta esperando respuesta.');

  const respuesta = interpretar(pregunta, entrada);

  const respuestas = [...p.respuestas, { campo: pregunta.campo, pregunta: pregunta.etiqueta, respuesta, origen: 'tuya' as const }];
  const pendientes = p.preguntasPendientes.slice(1);
  await db
    .update(postulaciones)
    .set({ respuestas, preguntasPendientes: pendientes, estado: pendientes.length ? 'pendiente' : 'en_progreso' })
    .where(eq(postulaciones.id, postulacionId));
  if (pendientes.length === 0) await db.update(ofertas).set({ estado: 'apta' }).where(eq(ofertas.id, p.ofertaId));

  await guardarRespuesta(pregunta, respuesta); // para no volver a preguntarla (si es reutilizable)
  return avance(postulacionId);
}

/** Convierte lo que escribiste (o el botón que tocaste) en la respuesta final, validándola. */
function interpretar(pregunta: Pregunta, entrada: string): string {
  const texto = entrada.trim();
  if (!texto) throw new ErrorPostulacion('La respuesta está vacía.');

  if (pregunta.tipo === 'opcion' || pregunta.tipo === 'multiple') {
    // Listas largas (ej. 197 países): también se puede escribir el nombre en vez del número
    if (pregunta.tipo === 'opcion' && !/^\d+$/.test(texto)) {
      const buscado = normalizar(texto);
      const exacta = pregunta.opciones.find((o) => normalizar(o.etiqueta) === buscado);
      const parecidas = pregunta.opciones.filter((o) => normalizar(o.etiqueta).includes(buscado));
      const elegida = exacta ?? (parecidas.length === 1 ? parecidas[0] : undefined);
      if (elegida) return elegida.etiqueta;
      if (parecidas.length > 1) {
        throw new ErrorPostulacion(`Hay varias opciones con "${texto}": ${parecidas.slice(0, 5).map((o) => o.etiqueta).join(', ')}. Sé más específico o usa el número.`);
      }
      throw new ErrorPostulacion(`No encontré "${texto}" entre las opciones. Escribe el nombre como aparece o el número.`);
    }
    const numeros = texto.split(/[\s,]+/).filter(Boolean).map(Number);
    const validos = numeros.every((n) => Number.isInteger(n) && n >= 1 && n <= pregunta.opciones.length);
    if (!validos || numeros.length === 0) throw new ErrorPostulacion(`Responde con el número de la opción (1 a ${pregunta.opciones.length}).`);
    if (pregunta.tipo === 'opcion' && numeros.length > 1) throw new ErrorPostulacion('Esta pregunta admite una sola opción.');
    return [...new Set(numeros)].map((n) => pregunta.opciones[n - 1]!.etiqueta).join(' | ');
  }

  const limite = pregunta.tipo === 'parrafo' ? LIMITE.parrafo : LIMITE.texto;
  if (texto.length > limite) throw new ErrorPostulacion(`Es muy larga (${texto.length} caracteres; máximo ${limite}).`);
  return texto;
}

/** Descarta la oferta actual: borra la postulación a medias y marca la oferta como descartada. */
export async function saltarActiva(): Promise<string | null> {
  const activa = await postulacionActiva();
  if (!activa) return null;
  await db.delete(postulaciones).where(eq(postulaciones.id, activa.id));
  const [oferta] = await db.update(ofertas).set({ estado: 'descartada' }).where(eq(ofertas.id, activa.ofertaId)).returning();
  return oferta ? `${oferta.titulo} — ${oferta.empresa}` : 'la oferta';
}

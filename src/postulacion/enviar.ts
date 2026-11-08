import { mkdir, readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { and, count, eq, gte } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/cliente.js';
import { fuentes, ofertas, postulaciones } from '../db/esquema.js';
import { obtenerAjuste } from '../ajustes.js';
import { rutaHojaDeVida } from '../hojas-de-vida.js';
import { logger } from '../logger.js';
import { leerFormularioGreenhouse } from './greenhouse-preguntas.js';
import { llenarGreenhouse, urlFormularioGreenhouse } from './llenar-greenhouse.js';
import { conVentanaVisible } from './navegador.js';
import { elegirHojaDeVida, ErrorPostulacion, ubicar } from './preparar.js';

const MINUTOS_DE_ESPERA = 20; // tiempo que la ventana espera a que termines

export type ResultadoEnvio =
  | { tipo: 'enviada'; titulo: string; empresa: string; url: string; evidencia: string }
  | { tipo: 'no-confirmada'; titulo: string; empresa: string; url: string; motivo: string; despues: string | null }
  | { tipo: 'limite'; enviadasHoy: number }
  | { tipo: 'ocupada' };

/** Medianoche de hoy en Colombia (UTC-5, sin horario de verano). */
function inicioDelDiaColombia(): Date {
  const ahoraColombia = new Date(Date.now() - 5 * 3_600_000);
  return new Date(Date.UTC(ahoraColombia.getUTCFullYear(), ahoraColombia.getUTCMonth(), ahoraColombia.getUTCDate(), 5));
}

export async function enviadasHoy(): Promise<number> {
  const [fila] = await db
    .select({ total: count() })
    .from(postulaciones)
    .where(and(eq(postulaciones.estado, 'enviada'), gte(postulaciones.enviadaEn, inicioDelDiaColombia())));
  return fila?.total ?? 0;
}

const EXITO = /thank you for applying|application (has been )?(submitted|received)|we('| ha)ve received your application|gracias por (postularte|tu postulaci[oó]n|aplicar)/i;

/**
 * Espera a que TÚ termines en la ventana (código del correo, CAPTCHA, Submit).
 * Solo cuenta como enviada con una señal POSITIVA nueva; si cierras la ventana o
 * se acaba el tiempo, no lo damos por enviado.
 */
async function esperarQueTermines(pagina: Page, textoAntes: string): Promise<{ confirmada: boolean; motivo: string }> {
  const exitoYaPresente = EXITO.test(textoAntes); // ej. si la descripción ya decía "thank you for applying"
  const limite = Date.now() + MINUTOS_DE_ESPERA * 60_000;

  while (Date.now() < limite) {
    if (pagina.isClosed()) return { confirmada: false, motivo: 'cerraste la ventana sin que apareciera la confirmación' };
    if (pagina.url().includes('/confirmation')) return { confirmada: true, motivo: 'página de confirmación' };
    const texto = await pagina.locator('body').innerText().catch(() => '');
    if (!exitoYaPresente && EXITO.test(texto)) return { confirmada: true, motivo: 'mensaje de confirmación' };
    await new Promise((resolver) => setTimeout(resolver, 2_000));
  }
  return { confirmada: false, motivo: `pasaron ${MINUTOS_DE_ESPERA} minutos sin confirmación` };
}

type AlAbrir = (detalle: { titulo: string; empresa: string; faltantes: string[]; pdf: string }) => Promise<void>;

/**
 * Fase 4d — MODO ASISTIDO. El bot NO hace clic en Submit:
 *  1. abre una ventana visible en tu PC, llena todo y adjunta tu PDF;
 *  2. guarda la evidencia y te avisa por Telegram;
 *  3. tú escribes el código del correo / resuelves el CAPTCHA / haces clic en Submit;
 *  4. el bot detecta la confirmación y registra la postulación.
 */
export async function enviarAsistido(postulacionId: number, alAbrir: AlAbrir): Promise<ResultadoEnvio> {
  const [fila] = await db
    .select({ postulacion: postulaciones, oferta: ofertas, fuente: fuentes })
    .from(postulaciones)
    .innerJoin(ofertas, eq(ofertas.id, postulaciones.ofertaId))
    .innerJoin(fuentes, eq(fuentes.id, ofertas.fuenteId))
    .where(eq(postulaciones.id, postulacionId));
  if (!fila) throw new ErrorPostulacion(`No existe la postulación ${postulacionId}.`);
  const { postulacion, oferta, fuente } = fila;
  if (postulacion.estado !== 'en_progreso') throw new ErrorPostulacion(`No se puede enviar (estado: ${postulacion.estado}).`);

  const hoy = await enviadasHoy();
  if (hoy >= config.LIMITE_DIARIO) return { tipo: 'limite', enviadasHoy: hoy };

  // CANDADO: "apta" -> "postulando" en UNA operación. Si tocaste el botón dos veces, el segundo no hace nada.
  const [bloqueada] = await db
    .update(ofertas)
    .set({ estado: 'postulando' })
    .where(and(eq(ofertas.id, oferta.id), eq(ofertas.estado, 'apta')))
    .returning({ id: ofertas.id });
  if (!bloqueada) return { tipo: 'ocupada' };

  const base = { titulo: oferta.titulo, empresa: oferta.empresa, url: oferta.url };
  const despues = `capturas/envio-${postulacionId}-despues.png`;
  const evidencia = `capturas/envio-${postulacionId}-antes.png`;

  try {
    const ubicacion = ubicar(oferta, fuente);
    if (!ubicacion) throw new ErrorPostulacion('Esta oferta no es de Greenhouse.');
    const formulario = await leerFormularioGreenhouse(ubicacion.tablero, ubicacion.idOferta);
    const paisTelefono = (await obtenerAjuste('pais')) || undefined;

    // El PDF se elige AHORA (no al crear la postulación): si subiste uno nuevo, se usa ese
    const idioma = await elegirHojaDeVida(formulario.idioma);
    const nombreArchivo = idioma === 'es' ? 'Hoja de vida.pdf' : 'Resume.pdf';
    const campoCv = formulario.preguntas.find((p) => p.tipo === 'archivo')?.campo ?? 'resume';
    const respuestasSinCv = postulacion.respuestas.filter((r) => r.origen !== 'automatica');
    await mkdir('capturas', { recursive: true });

    const resultado = await conVentanaVisible(async (pagina) => {
      await pagina.goto(urlFormularioGreenhouse(ubicacion.tablero, ubicacion.idOferta), { waitUntil: 'domcontentloaded' });
      const { faltantes } = await llenarGreenhouse(pagina, formulario.preguntas, respuestasSinCv, { subirCv: false, paisTelefono });

      await pagina
        .locator(`[id="${campoCv}"]`)
        .setInputFiles({ name: nombreArchivo, mimeType: 'application/pdf', buffer: await readFile(rutaHojaDeVida(idioma)) });
      const subido = await pagina.getByText(nombreArchivo).first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
      if (!subido) faltantes.push('Resume/CV (revisa que se haya adjuntado)');

      // REGLA: evidencia de cómo quedó el formulario antes de enviar
      await pagina.locator('form').first().screenshot({ path: evidencia });
      const textoAntes = await pagina.locator('body').innerText();

      // Te dejamos el botón Submit a la vista y te avisamos
      await pagina.locator('form button[type="submit"]').first().scrollIntoViewIfNeeded().catch(() => {});
      await pagina.bringToFront();
      await alAbrir({ ...base, faltantes, pdf: idioma === 'es' ? 'español' : 'inglés' });
      logger.info({ postulacionId, empresa: oferta.empresa }, 'Ventana asistida abierta: esperando al usuario');

      const verificacion = await esperarQueTermines(pagina, textoAntes);
      if (!pagina.isClosed()) await pagina.screenshot({ path: despues }).catch(() => {});
      return verificacion;
    });

    if (!resultado.confirmada) {
      await db.update(postulaciones).set({ estado: 'error', error: resultado.motivo }).where(eq(postulaciones.id, postulacionId));
      await db.update(ofertas).set({ estado: 'manual' }).where(eq(ofertas.id, oferta.id));
      return { tipo: 'no-confirmada', ...base, motivo: resultado.motivo, despues: resultado.motivo.startsWith('cerraste') ? null : despues };
    }

    await db
      .update(postulaciones)
      .set({ estado: 'enviada', enviadaEn: new Date(), idiomaCv: idioma, rutaCaptura: evidencia, error: null })
      .where(eq(postulaciones.id, postulacionId));
    await db.update(ofertas).set({ estado: 'postulada' }).where(eq(ofertas.id, oferta.id));
    return { tipo: 'enviada', ...base, evidencia };
  } catch (error) {
    logger.error({ err: error, postulacionId }, 'Error en el envío asistido');
    const motivo = error instanceof ErrorPostulacion ? error.message : `error inesperado: ${(error as Error).message.split('\n')[0]}`;
    await db.update(postulaciones).set({ estado: 'error', error: motivo }).where(eq(postulaciones.id, postulacionId));
    await db.update(ofertas).set({ estado: 'manual' }).where(eq(ofertas.id, oferta.id));
    return { tipo: 'no-confirmada', ...base, motivo, despues: null };
  }
}

/** [Cancelar]: descarta la oferta y borra la postulación (tus respuestas guardadas se conservan). */
export async function cancelarPostulacion(postulacionId: number): Promise<string | null> {
  const [borrada] = await db
    .delete(postulaciones)
    .where(and(eq(postulaciones.id, postulacionId), eq(postulaciones.estado, 'en_progreso')))
    .returning();
  if (!borrada) return null;
  const [oferta] = await db.update(ofertas).set({ estado: 'descartada' }).where(eq(ofertas.id, borrada.ofertaId)).returning();
  return oferta ? `${oferta.titulo} — ${oferta.empresa}` : 'la oferta';
}

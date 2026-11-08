import { mkdir, readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { and, count, eq, gte } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/cliente.js';
import { fuentes, ofertas, postulaciones } from '../db/esquema.js';
import { obtenerAjuste } from '../ajustes.js';
import { logger } from '../logger.js';
import { leerFormularioGreenhouse } from './greenhouse-preguntas.js';
import { llenarGreenhouse, urlFormularioGreenhouse } from './llenar-greenhouse.js';
import { conNavegador } from './navegador.js';
import { ErrorPostulacion, ubicar } from './preparar.js';

export type ResultadoEnvio =
  | { tipo: 'enviada'; titulo: string; empresa: string; url: string; evidencia: string }
  | { tipo: 'no-confirmada'; titulo: string; empresa: string; url: string; motivo: string; evidencia: string | null; despues: string | null }
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
 * Tras hacer clic en Submit, observa la página hasta 30 s.
 * Solo devuelve "confirmada" con una señal POSITIVA clara; ante la duda, no lo damos por enviado.
 */
async function esperarResultado(pagina: Page, textoAntes: string): Promise<{ confirmada: boolean; motivo: string }> {
  // Si la página YA decía algo como "thank you for applying" antes del clic (ej. en la descripción), no cuenta
  const exitoYaPresente = EXITO.test(textoAntes);
  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    if (pagina.url().includes('/confirmation')) return { confirmada: true, motivo: 'página de confirmación' };
    const texto = await pagina.locator('body').innerText().catch(() => '');
    if (!exitoYaPresente && EXITO.test(texto)) return { confirmada: true, motivo: 'mensaje de confirmación' };

    // Desafío de reCAPTCHA visible: NO lo resolvemos (regla del proyecto)
    const desafio = pagina.locator('iframe[src*="recaptcha"][src*="bframe"], iframe[title*="challenge" i]');
    if ((await desafio.count()) > 0 && (await desafio.first().isVisible().catch(() => false))) {
      return { confirmada: false, motivo: 'apareció un CAPTCHA' };
    }
    // Errores de validación del formulario
    const errores = await pagina.locator('[id$="-error"]:visible, [role="alert"]:visible').allInnerTexts().catch(() => []);
    const conTexto = errores.map((e) => e.trim()).filter(Boolean);
    if (conTexto.length > 0) return { confirmada: false, motivo: `el formulario mostró errores: ${conTexto.slice(0, 3).join(' | ')}` };

    await pagina.waitForTimeout(1_000);
  }
  return { confirmada: false, motivo: 'no apareció ninguna confirmación en 30 s (posible reCAPTCHA invisible)' };
}

/**
 * Fase 4c: llena el formulario CON el PDF, guarda evidencia, hace clic en Submit y verifica.
 * Solo se llama cuando tocas [Enviar].
 */
export async function enviarPostulacion(postulacionId: number): Promise<ResultadoEnvio> {
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

  // CANDADO: pasar la oferta de "apta" a "postulando" en UNA sola operación.
  // Si ya no estaba "apta" (ej. tocaste Enviar dos veces), no se toca nada.
  const [bloqueada] = await db
    .update(ofertas)
    .set({ estado: 'postulando' })
    .where(and(eq(ofertas.id, oferta.id), eq(ofertas.estado, 'apta')))
    .returning({ id: ofertas.id });
  if (!bloqueada) return { tipo: 'ocupada' };

  const base = { titulo: oferta.titulo, empresa: oferta.empresa, url: oferta.url };
  const marcarNoConfirmada = async (motivo: string, evidencia: string | null, despues: string | null): Promise<ResultadoEnvio> => {
    await db.update(postulaciones).set({ estado: 'error', error: motivo, rutaCaptura: evidencia }).where(eq(postulaciones.id, postulacionId));
    await db.update(ofertas).set({ estado: 'manual' }).where(eq(ofertas.id, oferta.id));
    return { tipo: 'no-confirmada', ...base, motivo, evidencia, despues };
  };

  try {
    const ubicacion = ubicar(oferta, fuente);
    if (!ubicacion) throw new ErrorPostulacion('Esta oferta no es de Greenhouse.');
    const formulario = await leerFormularioGreenhouse(ubicacion.tablero, ubicacion.idOferta);
    const paisTelefono = (await obtenerAjuste('pais')) || undefined;

    await mkdir('capturas', { recursive: true });
    const evidencia = `capturas/envio-${postulacionId}-antes.png`;
    const despues = `capturas/envio-${postulacionId}-despues.png`;

    const resultado = await conNavegador(async (pagina) => {
      // SIN bloquearEnvios: esta vez sí se sube el PDF y se envía
      await pagina.goto(urlFormularioGreenhouse(ubicacion.tablero, ubicacion.idOferta), { waitUntil: 'domcontentloaded' });

      const cv = postulacion.respuestas.find((r) => r.origen === 'automatica');
      if (!cv) throw new ErrorPostulacion('No hay hoja de vida asociada a esta postulación.');
      // Subimos con un nombre presentable (no "cv-es.pdf")
      const nombreArchivo = cv.respuesta.includes('cv-es') ? 'Hoja de vida.pdf' : 'Resume.pdf';
      const respuestasSinCv = postulacion.respuestas.filter((r) => r !== cv);

      const { faltantes } = await llenarGreenhouse(pagina, formulario.preguntas, respuestasSinCv, { subirCv: false, paisTelefono });
      await pagina
        .locator(`[id="${cv.campo}"]`)
        .setInputFiles({ name: nombreArchivo, mimeType: 'application/pdf', buffer: await readFile(cv.respuesta) });
      // Esperar a que Greenhouse muestre el archivo subido
      const subido = await pagina.getByText(nombreArchivo).first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
      if (!subido) faltantes.push('Resume/CV (la subida no terminó)');

      if (faltantes.length > 0) {
        await pagina.locator('form').first().screenshot({ path: evidencia });
        return { enviado: false as const, motivo: `no envié porque faltan campos: ${faltantes.join(', ')}` };
      }

      // REGLA: evidencia justo antes de enviar
      await pagina.locator('form').first().screenshot({ path: evidencia });
      const textoAntes = await pagina.locator('body').innerText();
      await pagina.locator('form button[type="submit"]').first().click();
      logger.info({ postulacionId, empresa: oferta.empresa }, 'Clic en Submit');

      const verificacion = await esperarResultado(pagina, textoAntes);
      await pagina.screenshot({ path: despues });
      return { enviado: verificacion.confirmada, motivo: verificacion.motivo };
    });

    if (!resultado.enviado) return marcarNoConfirmada(resultado.motivo, evidencia, despues);

    await db
      .update(postulaciones)
      .set({ estado: 'enviada', enviadaEn: new Date(), rutaCaptura: evidencia, error: null })
      .where(eq(postulaciones.id, postulacionId));
    await db.update(ofertas).set({ estado: 'postulada' }).where(eq(ofertas.id, oferta.id));
    return { tipo: 'enviada', ...base, evidencia };
  } catch (error) {
    logger.error({ err: error, postulacionId }, 'Error enviando la postulación');
    const motivo = error instanceof ErrorPostulacion ? error.message : `error inesperado: ${(error as Error).message.split('\n')[0]}`;
    return marcarNoConfirmada(motivo, null, null);
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

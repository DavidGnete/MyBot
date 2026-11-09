import { mkdir, readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { and, count, eq, gte } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/cliente.js';
import { fuentes, ofertas, postulaciones } from '../db/esquema.js';
import { obtenerAjuste } from '../ajustes.js';
import { rutaHojaDeVida } from '../hojas-de-vida.js';
import { logger } from '../logger.js';
import { esperarCodigo } from './codigos.js';
import { leerFormularioGreenhouse } from './greenhouse-preguntas.js';
import { llenarGreenhouse, urlFormularioGreenhouse } from './llenar-greenhouse.js';
import { conNavegador } from './navegador.js';
import { elegirHojaDeVida, ErrorPostulacion, ubicar } from './preparar.js';

const MINUTOS_PARA_EL_CODIGO = 15;
const INTENTOS_DE_CODIGO = 2;

export type ResultadoEnvio =
  | { tipo: 'enviada'; titulo: string; empresa: string; url: string; evidencia: string }
  | { tipo: 'no-confirmada'; titulo: string; empresa: string; url: string; motivo: string; despues: string | null }
  | { tipo: 'limite'; enviadasHoy: number }
  | { tipo: 'ocupada' };

/** Cómo hablarte durante el envío (el envío no sabe que existe Telegram). */
export type AvisosEnvio = {
  texto: (texto: string) => Promise<void>;
  archivo: (ruta: string, leyenda: string) => Promise<void>;
};

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
const PIDE_CODIGO = /verification code|security code|enter the code|one-time code|c[oó]digo de (verificaci[oó]n|seguridad)|ingresa el c[oó]digo/i;
const CODIGO_INVALIDO = /invalid code|incorrect code|code (is )?(invalid|incorrect|expired)|c[oó]digo (inv[aá]lido|incorrecto|expirado)/i;

type Estado = 'confirmada' | 'pide-codigo' | 'codigo-invalido' | 'captcha' | 'errores' | 'nada';

/**
 * Observa la página hasta `segundos`. Solo cuenta como confirmada con una señal POSITIVA
 * NUEVA (que no estuviera antes del clic).
 */
async function observar(pagina: Page, textoAntes: string, segundos: number): Promise<{ estado: Estado; detalle: string }> {
  const limite = Date.now() + segundos * 1_000;
  while (Date.now() < limite) {
    if (pagina.url().includes('/confirmation')) return { estado: 'confirmada', detalle: 'página de confirmación' };
    const texto = await pagina.locator('body').innerText().catch(() => '');
    const nuevo = (patron: RegExp) => patron.test(texto) && !patron.test(textoAntes);

    if (nuevo(EXITO)) return { estado: 'confirmada', detalle: 'mensaje de confirmación' };
    if (nuevo(CODIGO_INVALIDO)) return { estado: 'codigo-invalido', detalle: 'el código fue rechazado' };
    if (nuevo(PIDE_CODIGO)) return { estado: 'pide-codigo', detalle: 'pide código de verificación' };

    // Desafío de CAPTCHA visible: NO se resuelve (regla del proyecto)
    const desafio = pagina.locator('iframe[src*="recaptcha"][src*="bframe"], iframe[src*="hcaptcha"], iframe[title*="challenge" i]');
    if ((await desafio.count()) > 0 && (await desafio.first().isVisible().catch(() => false))) {
      return { estado: 'captcha', detalle: 'apareció un CAPTCHA' };
    }
    const errores = (await pagina.locator('[id$="-error"]:visible').allInnerTexts().catch(() => [])).map((e) => e.trim()).filter(Boolean);
    if (errores.length) return { estado: 'errores', detalle: `el formulario mostró errores: ${errores.slice(0, 3).join(' | ')}` };

    await pagina.waitForTimeout(1_000);
  }
  return { estado: 'nada', detalle: `no apareció ninguna confirmación en ${segundos} s` };
}

/** Busca dónde escribir el código: varias cajitas de 1 dígito o un campo de "code". */
async function campoDelCodigo(pagina: Page): Promise<{ tipo: 'cajas' | 'campo'; elemento: Locator } | null> {
  const cajas = pagina.locator('input[maxlength="1"]:visible');
  if ((await cajas.count()) >= 4) return { tipo: 'cajas', elemento: cajas.first() };
  const campo = pagina
    .locator(
      ['autocomplete="one-time-code"', 'id*="code" i', 'name*="code" i', 'aria-label*="code" i', 'placeholder*="code" i', 'aria-label*="código" i']
        .map((a) => `input[${a}]:visible`)
        .join(', '),
    )
    .first();
  return (await campo.count()) > 0 ? { tipo: 'campo', elemento: campo } : null;
}

async function ingresarCodigo(pagina: Page, codigo: string): Promise<boolean> {
  const destino = await campoDelCodigo(pagina);
  if (!destino) return false;
  if (destino.tipo === 'cajas') {
    await destino.elemento.click();
    await pagina.keyboard.type(codigo, { delay: 120 }); // las cajitas pasan solas a la siguiente
  } else {
    await destino.elemento.fill(codigo);
  }
  const boton = pagina.getByRole('button', { name: /submit|verify|confirm|continue|enviar|verificar|confirmar/i }).first();
  if ((await boton.count()) > 0 && (await boton.isVisible())) await boton.click();
  else await destino.elemento.press('Enter'); // aquí sí queremos enviar
  return true;
}

/**
 * Envío para el VPS (sin ventana): llena, adjunta tu PDF, guarda evidencia y hace clic en Submit.
 * Si Greenhouse pide el código del correo, te lo pregunta por Telegram y lo escribe.
 * Solo se llama cuando tocas [Enviar].
 */
export async function enviarPostulacion(postulacionId: number, avisos: AvisosEnvio): Promise<ResultadoEnvio> {
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
  const evidencia = `capturas/envio-${postulacionId}-antes.png`;
  const despues = `capturas/envio-${postulacionId}-despues.png`;

  const noConfirmada = async (motivo: string, conCaptura: boolean): Promise<ResultadoEnvio> => {
    await db.update(postulaciones).set({ estado: 'error', error: motivo }).where(eq(postulaciones.id, postulacionId));
    await db.update(ofertas).set({ estado: 'manual' }).where(eq(ofertas.id, oferta.id));
    return { tipo: 'no-confirmada', ...base, motivo, despues: conCaptura ? despues : null };
  };

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

    const resultado = await conNavegador(async (pagina): Promise<{ ok: boolean; motivo: string }> => {
      await pagina.goto(urlFormularioGreenhouse(ubicacion.tablero, ubicacion.idOferta), { waitUntil: 'domcontentloaded' });
      const { faltantes } = await llenarGreenhouse(pagina, formulario.preguntas, respuestasSinCv, { subirCv: false, paisTelefono });

      await pagina
        .locator(`[id="${campoCv}"]`)
        .setInputFiles({ name: nombreArchivo, mimeType: 'application/pdf', buffer: await readFile(rutaHojaDeVida(idioma)) });
      const subido = await pagina.getByText(nombreArchivo).first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
      if (!subido) faltantes.push('Resume/CV (la subida no terminó)');
      if (faltantes.length) return { ok: false, motivo: `no envié porque faltan campos: ${faltantes.join(', ')}` };

      // REGLA: evidencia justo antes de enviar
      await pagina.locator('form').first().screenshot({ path: evidencia });
      let textoAntes = await pagina.locator('body').innerText();
      await pagina.locator('form button[type="submit"]').first().click();
      logger.info({ postulacionId, empresa: oferta.empresa }, 'Clic en Submit');

      let observado = await observar(pagina, textoAntes, 30);

      // Código de verificación: TÚ lo escribes en Telegram
      for (let intento = 1; intento <= INTENTOS_DE_CODIGO && (observado.estado === 'pide-codigo' || observado.estado === 'codigo-invalido'); intento++) {
        const ruta = `capturas/envio-${postulacionId}-codigo.png`;
        await pagina.screenshot({ path: ruta });
        await avisos.archivo(
          ruta,
          (observado.estado === 'codigo-invalido' ? '❌ Ese código no funcionó. ' : '') +
            `🔐 ${oferta.empresa} (Greenhouse) pide el código de verificación que llegó a tu correo.\n\n` +
            `✍️ Escríbelo aquí como mensaje (tienes ${MINUTOS_PARA_EL_CODIGO} min). Para cancelar: /cancelar_codigo`,
        );
        const codigo = await esperarCodigo(oferta.empresa, MINUTOS_PARA_EL_CODIGO);
        if (!codigo) return { ok: false, motivo: 'no llegó el código a tiempo (o lo cancelaste)' };

        textoAntes = await pagina.locator('body').innerText();
        if (!(await ingresarCodigo(pagina, codigo))) return { ok: false, motivo: 'no encontré dónde escribir el código en la página' };
        observado = await observar(pagina, textoAntes, 30);
      }

      await pagina.screenshot({ path: despues });
      return { ok: observado.estado === 'confirmada', motivo: observado.detalle };
    });

    if (!resultado.ok) return noConfirmada(resultado.motivo, true);

    await db
      .update(postulaciones)
      .set({ estado: 'enviada', enviadaEn: new Date(), idiomaCv: idioma, rutaCaptura: evidencia, error: null })
      .where(eq(postulaciones.id, postulacionId));
    await db.update(ofertas).set({ estado: 'postulada' }).where(eq(ofertas.id, oferta.id));
    return { tipo: 'enviada', ...base, evidencia };
  } catch (error) {
    logger.error({ err: error, postulacionId }, 'Error en el envío');
    const motivo = error instanceof ErrorPostulacion ? error.message : `error inesperado: ${(error as Error).message.split('\n')[0]}`;
    return noConfirmada(motivo, false);
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

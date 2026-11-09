import { PgBoss } from 'pg-boss';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { buscarOfertas } from '../busqueda/buscar-ofertas.js';
import { formatearResultado } from '../busqueda/formatear.js';
import { generarVistaPrevia } from '../postulacion/vista-previa.js';
import { ErrorPostulacion } from '../postulacion/preparar.js';
import { enviarPostulacion, enviadasHoy } from '../postulacion/enviar.js';
import { construirResumen } from '../resumen.js';

const COLA_BUSCAR = 'buscar-ofertas';
const COLA_VISTA_PREVIA = 'vista-previa';
const COLA_RESUMEN = 'resumen-diario';
// Cola nueva (no "enviar-postulacion"): pg-boss no cambia las opciones de una cola que ya existe
const COLA_ENVIAR = 'envio-con-codigo';
const CADA_HORA = '0 * * * *'; // cron: minuto 0 de cada hora

type DatosBusqueda = { manual?: boolean };
type DatosVistaPrevia = { postulacionId: number };
type DatosEnvio = { postulacionId: number };

/** Un botón bajo un mensaje: texto visible + dato que recibe el bot al tocarlo. */
export type Boton = { texto: string; datos: string };

/** Cómo avisarte. El programador no sabe que existe Telegram: solo sabe avisar. */
export type Avisos = {
  texto: (texto: string) => Promise<void>;
  archivo: (ruta: string, leyenda: string, botones?: Boton[]) => Promise<void>;
};

/**
 * pg-boss guarda los trabajos en Postgres (en su propio esquema "pgboss").
 * Ventajas frente a un simple setInterval:
 *  - la programación sobrevive reinicios;
 *  - la política "stately" impide que corran dos trabajos iguales a la vez;
 *  - si un trabajo falla, queda registrado y se reintenta.
 */
export async function iniciarProgramador(avisos: Avisos) {
  const boss = new PgBoss(config.DATABASE_URL);
  boss.on('error', (error) => logger.error({ err: error }, 'Error en pg-boss'));
  await boss.start();

  // ---- Búsqueda de ofertas: cada hora ----
  await boss.createQueue(COLA_BUSCAR, { policy: 'stately', retryLimit: 2, retryDelay: 60 });
  await boss.schedule(COLA_BUSCAR, CADA_HORA, {}, { tz: 'America/Bogota' });

  await boss.work<DatosBusqueda>(COLA_BUSCAR, async ([trabajo]) => {
    const manual = trabajo?.data?.manual === true;
    logger.info({ manual }, 'Iniciando búsqueda de ofertas');
    const resultado = await buscarOfertas();
    const mensaje = formatearResultado(resultado, manual);
    if (mensaje) await avisos.texto(mensaje);
  });

  // ---- Resumen diario "sigo vivo": 8:00 a. m. hora Colombia ----
  await boss.createQueue(COLA_RESUMEN, { policy: 'stately', retryLimit: 1, retryDelay: 300 });
  await boss.schedule(COLA_RESUMEN, '0 8 * * *', {}, { tz: 'America/Bogota' });
  await boss.work(COLA_RESUMEN, async () => {
    await avisos.texto(await construirResumen());
  });

  // ---- Vista previa del formulario (fase 4b): un navegador a la vez ----
  // Sin reintentos automáticos: si falla, te avisamos y tú decides (/llenar_N).
  await boss.createQueue(COLA_VISTA_PREVIA, { policy: 'standard', retryLimit: 0 });

  await boss.work<DatosVistaPrevia>(COLA_VISTA_PREVIA, async ([trabajo]) => {
    const postulacionId = trabajo!.data.postulacionId;
    try {
      const vista = await generarVistaPrevia(postulacionId);
      const estado = vista.faltantes.length
        ? `⚠️ No pude llenar ${vista.faltantes.length} campo(s):\n${vista.faltantes.map((f) => `• ${f}`).join('\n')}`
        : '✅ Llené todos los campos obligatorios.';
      const pdf = vista.hojaDeVida?.includes('cv-es') ? 'en español' : 'en inglés';
      const completa = vista.faltantes.length === 0;
      await avisos.archivo(
        vista.rutaCaptura,
        `👀 Vista previa: ${vista.titulo} — ${vista.empresa}\n\n${estado}\n\n` +
          `📎 Resume/CV: en la captura aparece VACÍO a propósito. Tu hoja de vida ${pdf} se adjuntará ` +
          'solo cuando apruebes el envío (Greenhouse la sube a sus servidores apenas se selecciona).\n\n' +
          '🔒 Modo solo lectura: no se envió nada a la empresa.\n' +
          (completa ? 'Revisa la captura y decide 👇' : `Corrige y repite: /llenar_${vista.ofertaId}`),
        // Solo ofrecemos [Enviar] si el formulario quedó completo
        completa
          ? [
              { texto: '✅ Enviar postulación', datos: `enviar:${postulacionId}` },
              { texto: '❌ Cancelar', datos: `cancelar:${postulacionId}` },
            ]
          : undefined,
      );
    } catch (error) {
      const mensaje = error instanceof ErrorPostulacion ? error.message : (error as Error).message.split('\n')[0];
      logger.error({ err: error, postulacionId }, 'Falló la vista previa');
      await avisos.texto(`❌ No pude llenar el formulario: ${mensaje}`);
    }
  });

  // ---- Envío (VPS, sin ventana): solo al tocar [Enviar]; sin reintentos automáticos ----
  // expireInSeconds: puede esperar hasta 2 × 15 min tu código del correo (el límite por defecto es 15)
  await boss.createQueue(COLA_ENVIAR, { policy: 'standard', retryLimit: 0, expireInSeconds: 45 * 60 });

  await boss.work<DatosEnvio>(COLA_ENVIAR, async ([trabajo]) => {
    const resultado = await enviarPostulacion(trabajo!.data.postulacionId, avisos).catch((error: unknown) => {
      logger.error({ err: error }, 'Falló el envío');
      return null;
    });
    if (!resultado) return avisos.texto('❌ Ocurrió un error inesperado al enviar. Revisa los logs.');

    switch (resultado.tipo) {
      case 'limite':
        return avisos.texto(
          `⏸️ Ya enviaste ${resultado.enviadasHoy} postulaciones hoy (límite: ${config.LIMITE_DIARIO}). ` +
            'Esta queda lista: vuelve a tocar Enviar mañana.',
        );
      case 'ocupada':
        return avisos.texto('⏳ Esa postulación ya se está enviando o ya se envió.');
      case 'enviada':
        return avisos.archivo(
          resultado.evidencia,
          `✅ ¡Postulación enviada!\n\nCargo: ${resultado.titulo}\nEmpresa: ${resultado.empresa}\nSitio: Greenhouse\nLink: ${resultado.url}\n\n` +
            `(Evidencia: así estaba el formulario al enviarlo. Hoy llevas ${await enviadasHoy()}/${config.LIMITE_DIARIO}.)`,
        );
      case 'no-confirmada':
        await avisos.texto(
          `✋ No vi la confirmación del envío a ${resultado.empresa} (${resultado.titulo}).\nMotivo: ${resultado.motivo}\n\n` +
            '⚠️ Revisa tu correo: si llegó la confirmación de Greenhouse, el envío SÍ funcionó.\n' +
            `Si no llegó, toca /postular_… para reintentar, o postula aquí: ${resultado.url}`,
        );
        if (resultado.despues) await avisos.archivo(resultado.despues, 'Así quedó la página al final.');
        return;
    }
  });

  logger.info('Programador listo: búsqueda cada hora (minuto 0, hora Colombia), vistas previas y envíos');

  return {
    /** Encola una búsqueda inmediata (comando /buscar). */
    buscarAhora: () => boss.send(COLA_BUSCAR, { manual: true } satisfies DatosBusqueda),
    /** Encola el llenado en modo solo lectura de una postulación. */
    llenarVistaPrevia: (postulacionId: number) => boss.send(COLA_VISTA_PREVIA, { postulacionId } satisfies DatosVistaPrevia),
    /** Encola el envío real (solo desde el botón [Enviar]). */
    enviar: (postulacionId: number) => boss.send(COLA_ENVIAR, { postulacionId } satisfies DatosEnvio),
    detener: () => boss.stop({ graceful: true }),
  };
}

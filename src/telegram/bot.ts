import { Bot, GrammyError, HttpError, InlineKeyboard, InputFile } from 'grammy';
import type { Boton } from '../trabajos/programador.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { comandos } from './comandos.js';
import { crearComandosFuentes } from './comandos-fuentes.js';
import { recibirPdf } from './recibir-pdf.js';
import { crearPostular } from './postular.js';

type Dependencias = {
  buscarAhora: () => Promise<string | null>;
  llenarVistaPrevia: (postulacionId: number) => Promise<string | null>;
  enviar: (postulacionId: number) => Promise<string | null>;
};

export function crearBot(dependencias: Dependencias): Bot {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new Error('Falta TELEGRAM_BOT_TOKEN en .env (créalo con @BotFather en Telegram)');
  }
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // ---- Seguridad: el bot SOLO obedece a tu chat ----
  // Este middleware corre antes que todo lo demás. Si el mensaje no viene de tu
  // chat, no llamamos a next() y nada más se ejecuta.
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;

    if (config.TELEGRAM_CHAT_ID === undefined) {
      // Modo configuración: aún no sabemos tu chat id. Solo respondemos con él.
      if (chatId && ctx.message?.text === '/start') {
        await ctx.reply(`Tu chat id es: ${chatId}\nAgrégalo a .env como TELEGRAM_CHAT_ID=${chatId} y reinicia el bot.`);
      }
      return;
    }

    if (chatId !== config.TELEGRAM_CHAT_ID) {
      logger.warn({ chatId }, 'Mensaje de un chat no autorizado: ignorado');
      return;
    }
    await next();
  });

  // ---- Comandos pegados con formato ----
  // Telegram marca un comando con una "entidad" bot_command al inicio del texto.
  // Si el comando se copia con formato (ej. como código), esa marca no viene y
  // grammY no lo reconoce. Si el texto empieza con "/", agregamos la marca nosotros.
  bot.use(async (ctx, next) => {
    const mensaje = ctx.message;
    const texto = mensaje?.text;
    if (mensaje && texto?.startsWith('/')) {
      const yaMarcado = mensaje.entities?.some((e) => e.type === 'bot_command' && e.offset === 0);
      if (!yaMarcado) {
        const largo = texto.split(/\s/, 1)[0]!.length;
        // Quitamos el formato que solapa al comando y anteponemos la marca
        const otras = (mensaje.entities ?? []).filter((e) => e.offset >= largo);
        mensaje.entities = [{ type: 'bot_command', offset: 0, length: largo }, ...otras];
      }
    }
    await next();
  });

  bot.use(comandos);
  bot.use(crearComandosFuentes(dependencias));
  bot.use(crearPostular(dependencias)); // antes del "No entendí": el texto libre puede ser una respuesta
  bot.use(recibirPdf);
  bot.on('message', (ctx) => ctx.reply('No entendí. Escribe /ayuda para ver los comandos.'));

  // Si un comando falla, el bot sigue vivo: registramos el error y te avisamos
  bot.catch(async (err) => {
    const e = err.error;
    const tipo = e instanceof GrammyError ? 'Telegram' : e instanceof HttpError ? 'red' : 'interno';
    logger.error({ err: e, tipo }, 'Error manejando un mensaje');
    await err.ctx.reply('⚠️ Ocurrió un error procesando eso. Revisa los logs.').catch(() => {});
  });

  return bot;
}

/** Envía un mensaje a tu chat (lo usarán el buscador y el postulador). */
export async function notificar(bot: Bot, texto: string): Promise<void> {
  if (config.TELEGRAM_CHAT_ID === undefined) return;
  // Sin vista previa de links: con varias ofertas, las previsualizaciones llenan la pantalla
  await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, texto, { link_preview_options: { is_disabled: true } });
}

/**
 * Envía un archivo (ej. la captura del formulario) como DOCUMENTO, no como foto:
 * Telegram comprime las fotos y recorta imágenes muy altas; como documento llega completa.
 */
export async function enviarArchivo(bot: Bot, ruta: string, leyenda: string, botones?: Boton[]): Promise<void> {
  if (config.TELEGRAM_CHAT_ID === undefined) return;
  const teclado = botones?.length ? new InlineKeyboard() : undefined;
  botones?.forEach((b) => teclado!.text(b.texto, b.datos));
  await bot.api.sendDocument(config.TELEGRAM_CHAT_ID, new InputFile(ruta), {
    caption: leyenda.slice(0, 1024), // límite de Telegram para leyendas
    ...(teclado && { reply_markup: teclado }),
  });
}

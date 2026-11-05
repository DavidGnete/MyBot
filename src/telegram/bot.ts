import { Bot, GrammyError, HttpError } from 'grammy';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { comandos } from './comandos.js';
import { recibirPdf } from './recibir-pdf.js';

export function crearBot(): Bot {
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

  bot.use(comandos);
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
  await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, texto);
}

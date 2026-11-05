import { Composer, InlineKeyboard } from 'grammy';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { IDIOMAS, rutaHojaDeVida, type Idioma } from '../hojas-de-vida.js';

// La API de bots de Telegram solo permite descargar archivos de hasta 20 MB.
const TAMANO_MAXIMO = 20 * 1024 * 1024;

// PDFs que esperan que elijas el idioma: id del mensaje con los botones -> file_id.
// El file_id no cabe en los botones (Telegram limita sus datos a 64 bytes), así que
// lo guardamos en memoria asociado a SU mensaje: cada botón sabe a qué PDF pertenece.
// Si el bot se reinicia antes de que elijas, solo tienes que reenviar el PDF.
const pdfsPendientes = new Map<number, string>();

export const recibirPdf = new Composer();

// 1) Llega un documento: validamos que sea PDF y preguntamos el idioma
recibirPdf.on('message:document', async (ctx) => {
  const documento = ctx.message.document;

  if (documento.mime_type !== 'application/pdf') {
    await ctx.reply('Solo acepto hojas de vida en PDF.');
    return;
  }
  if ((documento.file_size ?? 0) > TAMANO_MAXIMO) {
    await ctx.reply('El PDF pesa más de 20 MB, que es el límite de Telegram para bots. Comprímelo e intenta de nuevo.');
    return;
  }

  const teclado = new InlineKeyboard()
    .text(`🇪🇸 ${IDIOMAS.es}`, 'pdf:es')
    .text(`🇬🇧 ${IDIOMAS.en}`, 'pdf:en');
  const pregunta = await ctx.reply(`Recibí "${documento.file_name ?? 'documento.pdf'}". ¿En qué idioma está?`, {
    reply_markup: teclado,
  });
  pdfsPendientes.set(pregunta.message_id, documento.file_id);
});

// 2) Eliges el idioma: descargamos el archivo y lo guardamos
recibirPdf.callbackQuery(/^pdf:(es|en)$/, async (ctx) => {
  const idioma = ctx.match[1] as Idioma;
  const idMensaje = ctx.callbackQuery.message?.message_id;
  const fileId = idMensaje === undefined ? undefined : pdfsPendientes.get(idMensaje);

  if (!fileId) {
    // Botón viejo (ya usado, o el bot se reinició): aviso emergente y quitamos los botones.
    // No editamos el texto: si ya era el mismo, Telegram responde "message is not modified".
    await ctx.answerCallbackQuery({ text: 'Este botón ya no es válido. Si hace falta, reenvía el PDF.', show_alert: true });
    await ctx.editMessageReplyMarkup().catch(() => {}); // si ya no tenía botones, no importa
    return;
  }
  // Lo sacamos YA: si tocas dos veces rápido, el segundo toque cae en el caso de arriba
  pdfsPendientes.delete(idMensaje!);
  await ctx.answerCallbackQuery({ text: 'Guardando…' });

  const archivo = await ctx.api.getFile(fileId);
  // URL de descarga: contiene el token, por eso NUNCA se escribe en los logs
  const url = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${archivo.file_path}`;
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`No se pudo descargar el PDF de Telegram (HTTP ${respuesta.status})`);

  const contenido = Buffer.from(await respuesta.arrayBuffer());
  // Un PDF real empieza por "%PDF": verificación barata contra archivos renombrados
  if (contenido.subarray(0, 4).toString() !== '%PDF') {
    await ctx.editMessageText('Ese archivo no parece un PDF válido. Revisa el archivo y envíalo de nuevo.');
    return;
  }

  await mkdir('datos', { recursive: true });
  await writeFile(rutaHojaDeVida(idioma), contenido);

  logger.info({ idioma, bytes: contenido.length }, 'Hoja de vida actualizada');
  await ctx.editMessageText(`✅ Hoja de vida en ${IDIOMAS[idioma].toLowerCase()} guardada (${(contenido.length / 1024).toFixed(0)} KB).`);
});

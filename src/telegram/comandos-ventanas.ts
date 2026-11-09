import { Composer, InlineKeyboard, type Context } from 'grammy';
import { eq } from 'drizzle-orm';
import { db } from '../db/cliente.js';
import { ofertas } from '../db/esquema.js';
import { construirHistorial, construirResumen } from '../resumen.js';
import { responderLargo } from './mensajes-largos.js';

/**
 * Ofertas que postulas TÚ (✋): el bot vive en un VPS sin pantalla, así que no abre ventanas.
 * Te manda el link para abrirlo en TU navegador (donde ya tienes tus sesiones iniciadas)
 * y luego registra si postulaste.
 */
export const comandosVentanas = new Composer();

// /abrir_12 — link + botones para registrar en tu historial
comandosVentanas.hears(/^\/abrir_(\d+)/, async (ctx) => {
  const [oferta] = await db.select().from(ofertas).where(eq(ofertas.id, Number(ctx.match[1])));
  if (!oferta) {
    await ctx.reply('No existe esa oferta. Míralas con /ofertas');
    return;
  }
  await ctx.reply(
    `🔗 ${oferta.titulo} — ${oferta.empresa}\n${oferta.url}\n\n` +
      'Ábrelo en tu navegador (ahí ya tienes tus sesiones iniciadas) y postula. Cuando termines, cuéntame:',
    {
      link_preview_options: { is_disabled: true },
      reply_markup: new InlineKeyboard().text('✅ Ya postulé', `hecho:${oferta.id}`).text('❌ No postulé', `nohecho:${oferta.id}`),
    },
  );
});

async function registrarPostulacionManual(ctx: Context, ofertaId: number, postulo: boolean) {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  if (!postulo) {
    await ctx.reply('👌 Ok, la dejo como estaba. Puedes volver a abrirla cuando quieras.');
    return;
  }
  const [oferta] = await db.update(ofertas).set({ estado: 'postulada' }).where(eq(ofertas.id, ofertaId)).returning();
  await ctx.reply(oferta ? `✅ Registrada en tu /historial: ${oferta.titulo} — ${oferta.empresa}` : 'No encontré esa oferta.');
}

comandosVentanas.callbackQuery(/^hecho:(\d+)$/, (ctx) => registrarPostulacionManual(ctx, Number(ctx.match[1]), true));
comandosVentanas.callbackQuery(/^nohecho:(\d+)$/, (ctx) => registrarPostulacionManual(ctx, Number(ctx.match[1]), false));

// /historial y /resumen
comandosVentanas.command('historial', async (ctx) => responderLargo(ctx, await construirHistorial()));
comandosVentanas.command('resumen', async (ctx) => ctx.reply(await construirResumen()));

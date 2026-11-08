import type { Context } from 'grammy';

const LIMITE = 4000; // Telegram rechaza mensajes de más de 4096 caracteres

/**
 * Envía un texto largo en varios mensajes, cortando siempre entre líneas
 * (nunca a la mitad de un link).
 */
export async function responderLargo(ctx: Context, texto: string): Promise<void> {
  const partes: string[] = [];
  let actual = '';
  for (const linea of texto.split('\n')) {
    if (actual.length + linea.length + 1 > LIMITE && actual) {
      partes.push(actual);
      actual = '';
    }
    actual += (actual ? '\n' : '') + linea;
  }
  if (actual) partes.push(actual);

  for (const parte of partes) await ctx.reply(parte, { link_preview_options: { is_disabled: true } });
}

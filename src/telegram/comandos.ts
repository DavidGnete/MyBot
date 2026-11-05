import { Composer } from 'grammy';
import { count } from 'drizzle-orm';
import { db } from '../db/cliente.js';
import { ofertas } from '../db/esquema.js';
import { obtenerAjuste, guardarAjuste } from '../ajustes.js';
import { estadoHojasDeVida, IDIOMAS, type Idioma } from '../hojas-de-vida.js';

const AYUDA = `
Comandos:
/rol <cargo> — define el rol que busco (ej. /rol backend developer)
/rol — muestra el rol actual
/estado — hojas de vida, rol y ofertas
/ayuda — este mensaje

📎 Envíame tu hoja de vida en PDF para guardarla o reemplazarla.
`.trim();

export const comandos = new Composer();

comandos.command(['start', 'ayuda'], (ctx) => ctx.reply(`👋 Hola, soy tu postulador.\n\n${AYUDA}`));

comandos.command('rol', async (ctx) => {
  const rol = ctx.match.trim(); // el texto después de "/rol"

  if (!rol) {
    const actual = await obtenerAjuste('rol');
    await ctx.reply(actual ? `🎯 Rol actual: ${actual}` : 'Aún no hay rol. Usa: /rol backend developer');
    return;
  }
  if (rol.length > 100) {
    await ctx.reply('El rol es demasiado largo; usa pocas palabras (ej. "backend developer").');
    return;
  }

  await guardarAjuste('rol', rol);
  await ctx.reply(`✅ Rol guardado: ${rol}`);
});

comandos.command('estado', async (ctx) => {
  const [rol, hojas, porEstado] = await Promise.all([
    obtenerAjuste('rol'),
    estadoHojasDeVida(),
    db.select({ estado: ofertas.estado, total: count() }).from(ofertas).groupBy(ofertas.estado),
  ]);

  const lineasHojas = (Object.keys(IDIOMAS) as Idioma[]).map((idioma) => {
    const fecha = hojas[idioma];
    return `  ${IDIOMAS[idioma]}: ${fecha ? `✅ (${fecha.toLocaleDateString('es-CO')})` : '❌ falta'}`;
  });
  const lineasOfertas = porEstado.length
    ? porEstado.map((fila) => `  ${fila.estado}: ${fila.total}`)
    : ['  todavía no hay ofertas'];

  await ctx.reply(
    [
      `🎯 Rol: ${rol ?? '❌ sin definir (/rol)'}`,
      '',
      '📄 Hojas de vida:',
      ...lineasHojas,
      '',
      '💼 Ofertas:',
      ...lineasOfertas,
    ].join('\n'),
  );
});

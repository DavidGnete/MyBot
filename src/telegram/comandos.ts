import { Composer } from 'grammy';
import { count, eq } from 'drizzle-orm';
import { db } from '../db/cliente.js';
import { fuentes, ofertas } from '../db/esquema.js';
import { obtenerAjuste, guardarAjuste } from '../ajustes.js';
import { estadoHojasDeVida, IDIOMAS, type Idioma } from '../hojas-de-vida.js';
import { normalizar, separarLista } from '../busqueda/filtro.js';

const AYUDA = `
🎯 Qué busco
/rol <cargos> — separa alternativas con comas
   ej. /rol backend developer, backend engineer, node.js developer
/excluir <palabras> — descarta títulos que las tengan
   ej. /excluir senior, staff, manager   (/excluir ninguno para borrar)
/pais <país> — solo ofertas que acepten tu país (Himalayas), ej. /pais Colombia

📚 Dónde busco
Busco automáticamente en Himalayas, Remote OK y Remotive (miles de empresas). No tienes que configurar nada.
/fuente <link> — opcional: suma una empresa específica (Greenhouse o Lever)
/fuentes — lista de fuentes
/quitar <número> — desactiva una fuente
/buscar — buscar ahora (también busco solo cada hora)

📝 Postular
/ofertas — ofertas abiertas; toca /postular_N para empezar
/saltar — descarta la oferta que estoy preparando
/respuestas — lo que recuerdo de ti (✏️ /editar_N cambia una, 🗑️ /olvidar_N la borra)

📊 /estado — resumen   ❓ /ayuda — este mensaje
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
  if (rol.length > 300) {
    await ctx.reply('Es demasiado largo; usa pocas alternativas separadas por comas.');
    return;
  }

  await guardarAjuste('rol', rol);
  const alternativas = separarLista(rol);
  await ctx.reply(
    `✅ Rol guardado. Un título coincide si contiene todas las palabras de alguna de estas ${alternativas.length} alternativa(s):\n` +
      alternativas.map((a) => `• ${a}`).join('\n'),
  );
});

// País desde el que trabajas: Himalayas lo usa para traer solo ofertas que lo aceptan
comandos.command('pais', async (ctx) => {
  const pais = ctx.match.trim();

  if (!pais) {
    const actual = await obtenerAjuste('pais');
    await ctx.reply(actual ? `🌎 País: ${actual}` : 'Sin país: verás ofertas de todo el mundo. Ej: /pais Colombia');
    return;
  }
  if (normalizar(pais) === 'ninguno') {
    await guardarAjuste('pais', '');
    await ctx.reply('✅ Sin filtro de país.');
    return;
  }
  // Himalayas usa nombres en inglés con mayúscula inicial: "Colombia", "Mexico", "Spain"
  const formateado = pais.charAt(0).toUpperCase() + pais.slice(1).toLowerCase();
  await guardarAjuste('pais', formateado);
  await ctx.reply(`✅ País: ${formateado}. Himalayas traerá solo ofertas que acepten candidatos de ahí.`);
});

comandos.command('excluir', async (ctx) => {
  const texto = ctx.match.trim();

  if (!texto) {
    const actual = await obtenerAjuste('excluir');
    await ctx.reply(actual ? `🚫 Excluyo: ${actual}` : 'No excluyes nada. Ej: /excluir senior, staff, manager');
    return;
  }
  if (normalizar(texto) === 'ninguno') {
    await guardarAjuste('excluir', '');
    await ctx.reply('✅ Ya no excluyo ninguna palabra.');
    return;
  }

  await guardarAjuste('excluir', texto);
  await ctx.reply(`✅ Descartaré títulos con: ${separarLista(texto).join(' | ')}`);
});

comandos.command('estado', async (ctx) => {
  const [rol, excluir, pais, hojas, porEstado, totalFuentes] = await Promise.all([
    obtenerAjuste('rol'),
    obtenerAjuste('excluir'),
    obtenerAjuste('pais'),
    estadoHojasDeVida(),
    db.select({ estado: ofertas.estado, total: count() }).from(ofertas).groupBy(ofertas.estado),
    db.$count(fuentes, eq(fuentes.activa, true)),
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
      `🚫 Excluir: ${excluir || 'nada'}`,
      `🌎 País: ${pais || 'todos'}`,
      `📚 Fuentes activas: ${totalFuentes}`,
      '',
      '📄 Hojas de vida:',
      ...lineasHojas,
      '',
      '💼 Ofertas:',
      ...lineasOfertas,
    ].join('\n'),
  );
});

import { Composer } from 'grammy';
import { eq } from 'drizzle-orm';
import { db } from '../db/cliente.js';
import { fuentes } from '../db/esquema.js';
import { interpretarFuente, LECTORES } from '../fuentes/index.js';
import { ErrorFuente } from '../fuentes/tipos.js';

type Dependencias = { buscarAhora: () => Promise<string | null> };

export function crearComandosFuentes({ buscarAhora }: Dependencias) {
  const comandos = new Composer();

  // /fuente https://boards.greenhouse.io/gitlab
  comandos.command('fuente', async (ctx) => {
    const interpretada = interpretarFuente(ctx.match);
    if (!interpretada) {
      await ctx.reply(
        'Pega el link de empleos de la empresa, por ejemplo:\n' +
          '/fuente https://boards.greenhouse.io/gitlab\n' +
          '/fuente https://jobs.lever.co/palantir\n' +
          '/fuente himalayas   (también: remotive, remoteok)',
      );
      return;
    }

    // Antes de guardarla, comprobamos que la empresa existe en esa plataforma
    let verificacion: { nombre: string; totalOfertas: number };
    try {
      verificacion = await LECTORES[interpretada.tipo].verificar(interpretada.identificador);
    } catch (error) {
      await ctx.reply(`❌ No pude leer esa fuente: ${error instanceof ErrorFuente ? error.message : 'error inesperado'}`);
      return;
    }

    // Upsert: si ya existía (aunque estuviera desactivada), la reactiva
    await db
      .insert(fuentes)
      .values({ ...interpretada, nombre: verificacion.nombre })
      .onConflictDoUpdate({ target: [fuentes.tipo, fuentes.identificador], set: { activa: true, nombre: verificacion.nombre } });

    await ctx.reply(
      `✅ Fuente activa: ${verificacion.nombre} (${interpretada.tipo}), ${verificacion.totalOfertas} ofertas publicadas.\n` +
        'Usa /buscar para revisarla ya, o espera a la búsqueda de cada hora.',
    );
  });

  comandos.command('fuentes', async (ctx) => {
    const todas = await db.select().from(fuentes).orderBy(fuentes.id);
    if (todas.length === 0) {
      await ctx.reply('No hay fuentes. Agrega una con /fuente <link>');
      return;
    }
    const lineas = todas.map((f) => `${f.activa ? '🟢' : '⚪'} ${f.id}. ${f.nombre} (${f.tipo}: ${f.identificador})`);
    await ctx.reply(['📚 Fuentes:', ...lineas, '', 'Desactiva una con /quitar <número>'].join('\n'));
  });

  // Desactivamos en vez de borrar: sus ofertas guardadas siguen apuntando a ella
  comandos.command('quitar', async (ctx) => {
    const id = Number(ctx.match.trim());
    if (!Number.isInteger(id) || id <= 0) {
      await ctx.reply('Usa: /quitar <número> (míralo con /fuentes)');
      return;
    }
    const [actualizada] = await db.update(fuentes).set({ activa: false }).where(eq(fuentes.id, id)).returning();
    await ctx.reply(actualizada ? `⚪ ${actualizada.nombre} desactivada.` : `No existe la fuente ${id}.`);
  });

  comandos.command('buscar', async (ctx) => {
    const id = await buscarAhora();
    // Con la política "stately", si ya hay una búsqueda en cola, pg-boss no crea otra (devuelve null)
    await ctx.reply(id ? '🔎 Buscando… te aviso al terminar.' : '⏳ Ya hay una búsqueda en curso; te aviso al terminar.');
  });

  return comandos;
}

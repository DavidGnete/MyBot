import { Composer, InlineKeyboard, type Context } from 'grammy';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/cliente.js';
import { fuentes, ofertas, postulaciones, respuestasGuardadas } from '../db/esquema.js';
import {
  ErrorPostulacion,
  esAutomatizable,
  iniciarPostulacion,
  postulacionActiva,
  responder,
  saltarActiva,
  type Avance,
} from '../postulacion/preparar.js';
import { cancelarPostulacion } from '../postulacion/enviar.js';
import { editarRespuestaGuardada } from '../postulacion/respuestas-guardadas.js';

const MAXIMO_BOTONES = 12; // con más opciones, mejor una lista numerada

type Dependencias = {
  llenarVistaPrevia: (postulacionId: number) => Promise<string | null>;
  enviar: (postulacionId: number) => Promise<string | null>;
};

/** Muestra la siguiente pregunta (con botones si es de selección) o, al terminar, lanza la vista previa. */
async function mostrarAvance(ctx: Context, avance: Avance, deps: Dependencias): Promise<void> {
  if (avance.tipo === 'completa') {
    await deps.llenarVistaPrevia(avance.postulacionId);
    await ctx.reply(
      `✅ Tengo todas las respuestas para "${avance.titulo}" — ${avance.empresa}.\n` +
        `Reutilicé ${avance.reutilizadas} respuesta(s) guardada(s) y tú respondiste ${avance.tuyas}.\n\n` +
        '🖥️ Estoy llenando el formulario en modo solo lectura (no se envía nada).\n' +
        'En ~1 minuto te llega la captura con los botones [✅ Enviar] [❌ Cancelar].',
    );
    return;
  }

  const { pregunta, numero, total, empresa, postulacionId } = avance;
  const cabecera = `❓ ${empresa} — pregunta ${numero} de ${total}${pregunta.obligatoria ? ' (obligatoria)' : ''}\n\n${pregunta.etiqueta}`;
  const pie = '\n\n(/saltar para descartar esta oferta)';

  if (pregunta.tipo === 'opcion' && pregunta.opciones.length <= MAXIMO_BOTONES) {
    const teclado = new InlineKeyboard();
    pregunta.opciones.forEach((opcion, i) => teclado.text(opcion.etiqueta, `resp:${postulacionId}:${i + 1}`).row());
    await ctx.reply(cabecera + pie, { reply_markup: teclado });
    return;
  }
  if (pregunta.tipo === 'opcion' || pregunta.tipo === 'multiple') {
    const lista = pregunta.opciones.map((o, i) => `${i + 1}. ${o.etiqueta}`).join('\n');
    const instruccion =
      pregunta.tipo === 'multiple'
        ? 'Responde con los números separados por comas (ej: 1, 3)'
        : 'Responde con el número o escribe el nombre (ej: Colombia)';
    await ctx.reply(`${cabecera}\n\n${lista}\n\n${instruccion}.${pie}`);
    return;
  }
  const ayuda = pregunta.tipo === 'parrafo' ? 'Escribe tu respuesta (puede ser larga).' : 'Escribe tu respuesta (una línea).';
  await ctx.reply(`${cabecera}\n\n✍️ ${ayuda}${pie}`);
}

/** Errores esperados (ej. "ya hay otra en curso") se te muestran; los inesperados van al manejador general. */
async function conErrores(ctx: Context, accion: () => Promise<void>): Promise<void> {
  try {
    await accion();
  } catch (error) {
    if (error instanceof ErrorPostulacion) await ctx.reply(`⚠️ ${error.message}`);
    else throw error;
  }
}

export function crearPostular(deps: Dependencias): Composer<Context> {
  const postular = new Composer();

  const POR_GRUPO = 10; // por mensaje: 10 automáticas + 10 manuales

  // /ofertas — primero las que el bot puede llenar (con su comando), luego las manuales (con su link)
  postular.command('ofertas', async (ctx) => {
    const filas = await db
      .select({ oferta: ofertas, fuente: fuentes })
      .from(ofertas)
      .innerJoin(fuentes, eq(fuentes.id, ofertas.fuenteId))
      .where(inArray(ofertas.estado, ['nueva', 'pendiente', 'apta']))
      .orderBy(desc(ofertas.creadoEn));

    if (filas.length === 0) {
      await ctx.reply('No hay ofertas abiertas. Usa /buscar.');
      return;
    }

    const automaticas = filas.filter(({ oferta, fuente }) => esAutomatizable(oferta, fuente));
    const manuales = filas.filter(({ oferta, fuente }) => !esAutomatizable(oferta, fuente));
    const lineas: string[] = [];

    lineas.push(`🤖 PUEDO LLENARLAS YO (${automaticas.length}) — toca el comando de la que quieras:`);
    if (automaticas.length === 0) lineas.push('  (ninguna por ahora)');
    for (const { oferta } of automaticas.slice(0, POR_GRUPO)) {
      // La ubicación distingue vacantes con el mismo título (ej. Clara: México, Brasil, Colombia)
      const lugar = oferta.ubicacion ? ` (${oferta.ubicacion})` : '';
      lineas.push(`• ${oferta.titulo} — ${oferta.empresa}${lugar}`, `  👉 /postular_${oferta.id}`);
    }
    if (automaticas.length > POR_GRUPO) lineas.push(`  …y ${automaticas.length - POR_GRUPO} más`);

    lineas.push('', `✋ POSTULAS TÚ (${manuales.length}) — su página usa un sistema que aún no sé llenar:`);
    for (const { oferta } of manuales.slice(0, POR_GRUPO)) lineas.push(`• ${oferta.titulo} — ${oferta.empresa}`, `  ${oferta.url}`);
    if (manuales.length > POR_GRUPO) lineas.push(`  …y ${manuales.length - POR_GRUPO} más`);

    await ctx.reply(lineas.join('\n'), { link_preview_options: { is_disabled: true } });
  });

  // /postular_12 — Telegram permite tocar estos comandos directamente en la lista
  postular.hears(/^\/postular_(\d+)/, (ctx) =>
    conErrores(ctx, async () => {
      await ctx.reply('🔎 Leyendo el formulario…');
      const resultado = await iniciarPostulacion(Number(ctx.match[1]));
      if (resultado.tipo === 'manual') {
        await ctx.reply(`✋ Esta oferta no usa un formulario que yo sepa llenar. Postula tú aquí:\n${resultado.url}`);
        return;
      }
      await mostrarAvance(ctx, resultado, deps);
    }),
  );

  postular.command('saltar', async (ctx) => {
    const descartada = await saltarActiva();
    await ctx.reply(descartada ? `⏭️ Descarté "${descartada}". Puedes elegir otra con /ofertas.` : 'No hay ninguna postulación en curso.');
  });

  // Botón de una opción: resp:<postulación>:<número de opción>
  postular.callbackQuery(/^resp:(\d+):(\d+)$/, (ctx) =>
    conErrores(ctx, async () => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup().catch(() => {}); // quita los botones para no responder dos veces
      const avance = await responder(Number(ctx.match[1]), ctx.match[2]!);
      await mostrarAvance(ctx, avance, deps);
    }),
  );

  // Respuesta guardada que estás editando (/editar_N). En memoria: si el bot se reinicia, repites /editar_N.
  let editando: { id: number; pregunta: string } | undefined;

  // Texto libre: primero una edición en curso; luego una pregunta de postulación; si no, siguiente manejador.
  postular.on('message:text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) {
      editando = undefined; // cualquier comando cancela la edición
      return next();
    }
    if (editando) {
      const { id } = editando;
      editando = undefined;
      const resultado = await editarRespuestaGuardada(id, ctx.message.text.trim());
      await ctx.reply(
        resultado
          ? `✅ Actualicé "${resultado.pregunta}".` +
              (resultado.actualizadas ? ` También en ${resultado.actualizadas} postulación(es) que aún no se envían.` : '')
          : 'Esa respuesta ya no existe.',
      );
      return;
    }
    const activa = await postulacionActiva();
    if (!activa) return next();
    await conErrores(ctx, async () => mostrarAvance(ctx, await responder(activa.id, ctx.message.text), deps));
  });

  // /respuestas — lo que el bot recuerda; /olvidar_5 borra una
  postular.command('respuestas', async (ctx) => {
    const todas = await db.select().from(respuestasGuardadas).orderBy(respuestasGuardadas.id);
    if (todas.length === 0) {
      await ctx.reply('Aún no tengo respuestas guardadas.');
      return;
    }
    const lineas = todas.map((r) => `• ${r.pregunta}\n  → ${r.respuesta.slice(0, 80)}\n  ✏️ /editar_${r.id}   🗑️ /olvidar_${r.id}`);
    await ctx.reply(['🧠 Respuestas que reutilizo:', '', ...lineas].join('\n'));
  });

  // /editar_5 — el próximo mensaje que escribas será el nuevo valor
  postular.hears(/^\/editar_(\d+)/, async (ctx) => {
    const [fila] = await db.select().from(respuestasGuardadas).where(eq(respuestasGuardadas.id, Number(ctx.match[1])));
    if (!fila) {
      await ctx.reply('No existe esa respuesta. Míralas con /respuestas');
      return;
    }
    editando = { id: fila.id, pregunta: fila.pregunta };
    await ctx.reply(
      `✏️ "${fila.pregunta}"\nValor actual: ${fila.respuesta}\n\nEscribe el nuevo valor (o cualquier comando para cancelar).\n` +
        'Si es una pregunta de opciones (ej. nivel de inglés), mejor usa /olvidar_' + fila.id + ' y te la preguntaré con botones.',
    );
  });

  postular.hears(/^\/olvidar_(\d+)/, async (ctx) => {
    const [borrada] = await db.delete(respuestasGuardadas).where(eq(respuestasGuardadas.id, Number(ctx.match[1]))).returning();
    await ctx.reply(borrada ? `🗑️ Olvidé la respuesta a "${borrada.pregunta}". Te la preguntaré la próxima vez.` : 'No existe esa respuesta.');
  });

  // /llenar_12 — (re)genera la vista previa de la oferta 12, si ya tiene todas sus respuestas
  postular.hears(/^\/llenar_(\d+)/, async (ctx) => {
    const [postulacion] = await db.select().from(postulaciones).where(eq(postulaciones.ofertaId, Number(ctx.match[1])));
    if (!postulacion) {
      await ctx.reply('Esa oferta no tiene postulación. Empieza con /postular_' + ctx.match[1]);
      return;
    }
    if (postulacion.estado !== 'en_progreso') {
      await ctx.reply(`Aún no está lista para llenar (estado: ${postulacion.estado}).`);
      return;
    }
    await deps.llenarVistaPrevia(postulacion.id);
    await ctx.reply('🖥️ Llenando el formulario en modo solo lectura… te mando la captura en ~1 minuto.');
  });

  // [✅ Enviar postulación] bajo la vista previa: ENVÍO REAL
  postular.callbackQuery(/^enviar:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Abriendo la ventana en tu PC…' });
    await ctx.editMessageReplyMarkup().catch(() => {}); // quitar botones: evita tocar dos veces
    await deps.enviar(Number(ctx.match[1]));
    await ctx.reply('🖥️ Preparando la ventana en tu PC (lleno el formulario y adjunto tu hoja de vida). Te aviso cuando esté lista.');
  });

  // [❌ Cancelar]
  postular.callbackQuery(/^cancelar:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    const cancelada = await cancelarPostulacion(Number(ctx.match[1]));
    await ctx.reply(cancelada ? `❌ Cancelada: ${cancelada}. No se envió nada.` : 'Esa postulación ya no se puede cancelar.');
  });

  return postular;
}

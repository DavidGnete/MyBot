import { and, count, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from './db/cliente.js';
import { fuentes, ofertas, postulaciones } from './db/esquema.js';
import { obtenerAjuste } from './ajustes.js';
import { config } from './config.js';
import { enviadasHoy } from './postulacion/enviar.js';

const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000);

/** "☀️ Sigo vivo": lo que pasó en las últimas 24 h y lo que está pendiente. */
export async function construirResumen(): Promise<string> {
  const [rol, nuevasPorFuente, postuladas24h, porEstado, hoy] = await Promise.all([
    obtenerAjuste('rol'),
    db
      .select({ fuente: fuentes.nombre, total: count() })
      .from(ofertas)
      .innerJoin(fuentes, eq(fuentes.id, ofertas.fuenteId))
      .where(gte(ofertas.creadoEn, hace(24)))
      .groupBy(fuentes.nombre),
    db
      .select({ titulo: ofertas.titulo, empresa: ofertas.empresa })
      .from(ofertas)
      .where(and(eq(ofertas.estado, 'postulada'), gte(ofertas.actualizadoEn, hace(24)))),
    db
      .select({ estado: ofertas.estado, total: count() })
      .from(ofertas)
      .where(inArray(ofertas.estado, ['nueva', 'pendiente', 'apta', 'manual']))
      .groupBy(ofertas.estado),
    enviadasHoy(),
  ]);

  const total = (estado: string) => porEstado.find((f) => f.estado === estado)?.total ?? 0;
  const nuevas = nuevasPorFuente.reduce((suma, f) => suma + f.total, 0);

  const lineas = [
    '☀️ Sigo vivo. Resumen de las últimas 24 horas',
    `🎯 Rol: ${rol ?? 'sin definir'}`,
    '',
    `🆕 Ofertas nuevas: ${nuevas}` + (nuevas ? ` (${nuevasPorFuente.map((f) => `${f.fuente} ${f.total}`).join(' · ')})` : ''),
    `✅ Postulaste a: ${postuladas24h.length}` + (postuladas24h.length ? '' : ' — /ofertas para empezar'),
    ...postuladas24h.slice(0, 5).map((p) => `   • ${p.titulo} — ${p.empresa}`),
    '',
    '📋 Pendientes:',
    `   • Por revisar: ${total('nueva')}  (/ofertas)`,
    `   • Esperando tus respuestas: ${total('pendiente')}`,
    `   • Listas para enviar: ${total('apta')}`,
    `   • Para postular tú (✋): ${total('manual')}`,
    '',
    `📤 Envíos automáticos hoy: ${hoy}/${config.LIMITE_DIARIO}`,
  ];
  return lineas.join('\n');
}

/** Tus postulaciones (las del bot y las que confirmaste a mano), las más recientes primero. */
export async function construirHistorial(limite = 20): Promise<string> {
  const filas = await db
    .select({
      titulo: ofertas.titulo,
      empresa: ofertas.empresa,
      url: ofertas.url,
      fuente: fuentes.nombre,
      enviadaEn: postulaciones.enviadaEn,
      actualizadaEn: ofertas.actualizadoEn,
    })
    .from(ofertas)
    .innerJoin(fuentes, eq(fuentes.id, ofertas.fuenteId))
    .leftJoin(postulaciones, eq(postulaciones.ofertaId, ofertas.id))
    .where(eq(ofertas.estado, 'postulada'))
    .orderBy(desc(ofertas.actualizadoEn))
    .limit(limite);

  if (filas.length === 0) return 'Aún no tienes postulaciones registradas.';

  const lineas = [`📚 Tus últimas ${filas.length} postulaciones:`, ''];
  for (const f of filas) {
    const fecha = (f.enviadaEn ?? f.actualizadaEn).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    const como = f.enviadaEn ? '🤖' : '✋'; // 🤖 = asistida por el bot; ✋ = la hiciste tú y la confirmaste
    lineas.push(`${como} ${fecha} — ${f.titulo} — ${f.empresa} (vía ${f.fuente})`, `   ${f.url}`);
  }
  return lineas.join('\n');
}

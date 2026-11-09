import type { OfertaNueva, ResultadoBusqueda } from './buscar-ofertas.js';

const MAXIMO_LISTADAS = 10; // automáticas listadas
const POR_FUENTE = 5; // manuales listadas por plataforma
const LIMITE_TELEGRAM = 4000; // un mensaje admite 4096 caracteres

/** "Get on Board" -> "getonboard" (lo que se escribe en /ofertas <plataforma>) */
export function clavePlataforma(nombre: string): string {
  return nombre.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 7 -> "7 min", 185 -> "3 h 5 min" */
function duracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/**
 * Convierte el resultado en un mensaje para Telegram.
 * Devuelve null si no hay nada que valga la pena avisar (búsqueda automática sin novedades),
 * para no escribirte cada hora "no hay nada nuevo".
 */
export function formatearResultado(resultado: ResultadoBusqueda, manual: boolean): string | null {
  if (resultado.estado === 'sin-rol') return manual ? '⚠️ Primero define el rol: /rol backend developer' : null;
  if (resultado.estado === 'sin-fuentes') return manual ? '⚠️ No hay fuentes activas. Agrega una con /fuente <link>' : null;

  const lineas: string[] = [];
  const { nuevas, coincidencias, fuentesRevisadas, fuentesEnEspera, rol } = resultado;

  if (nuevas.length > 0) {
    // Agrupamos por plataforma: así ninguna (ej. Himalayas) tapa a las demás
    const porFuente = new Map<string, OfertaNueva[]>();
    for (const oferta of nuevas) porFuente.set(oferta.fuente, [...(porFuente.get(oferta.fuente) ?? []), oferta]);
    const resumen = [...porFuente].map(([fuente, lista]) => `${fuente} ${lista.length}`).join(' · ');
    lineas.push(`🆕 ${nuevas.length} oferta(s) nueva(s) para tu rol`, `(${resumen})`);

    // Primero las que el bot puede llenar (🤖), todas juntas
    const automaticas = nuevas.filter((o) => o.automatizable);
    if (automaticas.length) {
      lineas.push('', `🤖 Puedo llenarlas yo (${automaticas.length}):`);
      for (const o of automaticas.slice(0, MAXIMO_LISTADAS)) {
        lineas.push(`• ${o.titulo} — ${o.empresa}${o.ubicacion ? ` (${o.ubicacion})` : ''}`, `  👉 /postular_${o.id}`);
      }
    }

    // Luego las manuales, hasta POR_FUENTE de cada plataforma
    for (const [fuente, lista] of porFuente) {
      const manuales = lista.filter((o) => !o.automatizable);
      if (manuales.length === 0) continue;
      // "vía <fuente>": los agregadores exigen mencionarlos y enlazar su página
      lineas.push('', `✋ vía ${fuente} (${manuales.length}):`);
      for (const o of manuales.slice(0, POR_FUENTE)) {
        lineas.push(`• ${o.titulo} — ${o.empresa}${o.ubicacion ? ` (${o.ubicacion})` : ''}`, `  🖥️ /abrir_${o.id}  ${o.url}`);
      }
      if (manuales.length > POR_FUENTE) lineas.push(`  …y ${manuales.length - POR_FUENTE} más: /ofertas ${clavePlataforma(fuente)}`);
    }
    if (coincidencias > nuevas.length) {
      lineas.push('', `(Otras ${coincidencias - nuevas.length} ya te las había enviado: están más arriba en este chat.)`);
    }
  } else if (manual && fuentesRevisadas === 0) {
    lineas.push('⏳ No revisé ninguna página: todas se consultaron hace muy poco.');
  } else if (manual && coincidencias > 0) {
    lineas.push(
      `✅ Encontré ${coincidencias} oferta(s) para "${rol}", pero ya te las había enviado.`,
      'No te las repito para no llenarte el chat: búscalas más arriba en esta conversación.',
    );
  } else if (manual) {
    lineas.push(
      `🔎 Revisé ${fuentesRevisadas} página(s) de empleo y ninguna oferta coincide con "${rol}".`,
      'Prueba agregar variantes separadas por comas, ej: /rol full stack, fullstack, desarrollador full stack',
    );
  }

  if (manual && fuentesEnEspera.length > 0) {
    lineas.push(
      '',
      'ℹ️ Cada página de empleo permite consultarla solo cada cierto tiempo. Estas aún no se pueden revisar:',
      ...fuentesEnEspera.map((f) => `• ${f.nombre}: disponible en ${duracion(f.minutosRestantes)}`),
      'Igual las reviso solo cada hora y te aviso si aparece algo nuevo.',
    );
  }
  if (resultado.errores.length > 0) {
    lineas.push('', '⚠️ Páginas con problemas:', ...resultado.errores.map((e) => `• ${e.fuente}: ${e.mensaje}`));
  }

  if (lineas.length === 0) return null;
  const mensaje = lineas.join('\n');
  // Red de seguridad: si aun así es muy largo, Telegram lo rechazaría
  return mensaje.length > LIMITE_TELEGRAM ? `${mensaje.slice(0, LIMITE_TELEGRAM)}\n…(mira el resto con /ofertas)` : mensaje;
}

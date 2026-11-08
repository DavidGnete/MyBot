import type { ResultadoBusqueda } from './buscar-ofertas.js';

const MAXIMO_LISTADAS = 15; // un mensaje de Telegram admite 4096 caracteres

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
    const automaticas = nuevas.filter((o) => o.automatizable).length;
    lineas.push(
      `🆕 ${nuevas.length} oferta(s) nueva(s) para tu rol` +
        (automaticas ? ` — ${automaticas} las puedo llenar yo (toca 🤖 /postular_…):` : ':'),
      '',
    );
    // Primero las que el bot puede llenar
    const ordenadas = [...nuevas].sort((a, b) => Number(b.automatizable) - Number(a.automatizable));
    for (const oferta of ordenadas.slice(0, MAXIMO_LISTADAS)) {
      lineas.push(`• ${oferta.titulo} — ${oferta.empresa}${oferta.ubicacion ? ` (${oferta.ubicacion})` : ''}`);
      // "vía <fuente>": los agregadores exigen mencionarlos y enlazar su página
      lineas.push(oferta.automatizable ? `  🤖 /postular_${oferta.id}` : `  ✋ vía ${oferta.fuente}: ${oferta.url}`);
    }
    const restantes = nuevas.length - MAXIMO_LISTADAS;
    if (restantes > 0) lineas.push('', `…y ${restantes} más.`);
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

  return lineas.length > 0 ? lineas.join('\n') : null;
}

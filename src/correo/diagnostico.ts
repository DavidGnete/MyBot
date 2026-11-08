import { leerAlertasNuevas } from './buzon.js';
import { todosLosLinks, ofertasDelCorreo } from './extraer-links.js';

/**
 * npm run correo:diagnostico
 * Muestra las alertas de empleo de los últimos 3 días y QUÉ links reconoce el bot como ofertas.
 * Sirve para ajustar los patrones de src/correo/plataformas.ts con correos reales.
 * No imprime el cuerpo del correo: solo asunto, plataforma y links (sin parámetros de rastreo).
 * No modifica nada (ni el buzón ni la base de datos).
 */
const { alertas } = await leerAlertasNuevas(undefined);
console.log(`Alertas de empleo encontradas (últimos 3 días): ${alertas.length}\n`);

for (const alerta of alertas) {
  const ofertas = ofertasDelCorreo(alerta.html, alerta.plataforma);
  console.log(`📧 [${alerta.plataforma.nombre}] ${alerta.asunto.slice(0, 80)} — ${alerta.fecha?.toLocaleString('es-CO') ?? ''}`);
  console.log(`   ✅ Ofertas reconocidas: ${ofertas.length}`);
  for (const o of ofertas.slice(0, 5)) console.log(`      • ${o.titulo.slice(0, 70)}`);

  // Links que NO reconoció (para descubrir patrones nuevos), sin parámetros
  const reconocidas = new Set(ofertas.map((o) => o.url));
  const otros = todosLosLinks(alerta.html)
    .filter((l) => !reconocidas.has(l.url) && l.url.startsWith('http'))
    .map((l) => {
      const u = new URL(l.url);
      return `${u.host}${u.pathname.slice(0, 60)}  "${l.texto.slice(0, 40)}"`;
    });
  const unicos = [...new Set(otros)];
  if (unicos.length) {
    console.log(`   ❔ Otros links (${unicos.length}), por si alguno es una oferta no reconocida:`);
    for (const l of unicos.slice(0, 8)) console.log(`      - ${l}`);
  }
  console.log('');
}

import type { Plataforma } from './plataformas.js';

export type LinkDeCorreo = { url: string; texto: string };

/** Decodifica lo básico de HTML: &amp; &nbsp; &#233; &#xE9; ... */
function decodificar(texto: string): string {
  return texto
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

/** Todos los <a href="...">texto</a> del HTML del correo. */
export function todosLosLinks(html: string): LinkDeCorreo[] {
  const links: LinkDeCorreo[] = [];
  for (const [, href, interior] of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const texto = decodificar(interior!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    links.push({ url: decodificar(href!).trim(), texto });
  }
  return links;
}

// Textos de botones que no sirven como título de la oferta
const GENERICO = /^(ver( la)? oferta|ver m[aá]s|postular(me|te)?|aplicar|apply( now)?|view job|see job|ver empleo|m[aá]s informaci[oó]n)?$/i;

export type OfertaDeCorreo = { id: string; url: string; titulo: string };

/**
 * Se queda con los links que son ofertas de esta plataforma.
 * Una misma oferta suele aparecer varias veces (logo, título, botón): las juntamos
 * por id y nos quedamos con el texto más descriptivo como título.
 */
export function ofertasDelCorreo(html: string, plataforma: Plataforma): OfertaDeCorreo[] {
  const porId = new Map<string, OfertaDeCorreo>();

  for (const { url, texto } of todosLosLinks(html)) {
    if (!plataforma.oferta.test(url)) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    // Sin id, usamos la URL sin parámetros de rastreo (utm_, etc.)
    const id = plataforma.idDe(parsed) ?? `${parsed.host}${parsed.pathname}`;
    const titulo = GENERICO.test(texto) || texto.length < 4 ? '' : texto.slice(0, 200);

    const previa = porId.get(id);
    if (!previa) porId.set(id, { id, url, titulo });
    else if (titulo.length > previa.titulo.length) porId.set(id, { ...previa, titulo });
  }

  return [...porId.values()].map((o) => ({ ...o, titulo: o.titulo || `Oferta en ${plataforma.nombre}` }));
}

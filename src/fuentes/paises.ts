/**
 * "Colombia" -> "CO". Algunas APIs piden el código ISO del país en vez del nombre.
 * Usamos Intl.DisplayNames (viene con Node): conoce los nombres de todos los países
 * en inglés y en español, así no mantenemos una tabla a mano.
 */
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const nombreACodigo = new Map<string, string>();
for (const idioma of ['en', 'es']) {
  const nombres = new Intl.DisplayNames([idioma], { type: 'region' });
  for (const a of LETRAS) {
    for (const b of LETRAS) {
      const codigo = a + b;
      const nombre = nombres.of(codigo);
      if (nombre && nombre !== codigo) nombreACodigo.set(sinTildes(nombre), codigo);
    }
  }
}

export function codigoPais(nombre: string | undefined): string | undefined {
  return nombre ? nombreACodigo.get(sinTildes(nombre)) : undefined;
}

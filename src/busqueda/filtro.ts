/**
 * Filtro por palabras clave, sin IA. Funciones "puras": no tocan base de datos ni red,
 * así que son fáciles de probar y de entender.
 */

/** "Back-End Developer (Node.js)" -> "back end developer node.js" */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes: "ingeniería" -> "ingenieria"
    .replace(/[^a-z0-9+#.]+/g, ' ') // conserva c++, c#, node.js
    .trim();
}

/** "backend developer, backend engineer" -> [["backend","developer"], ["backend","engineer"]] */
export function separarLista(texto: string | undefined): string[] {
  return (texto ?? '').split(',').map((parte) => normalizar(parte)).filter(Boolean);
}

/** ¿El texto contiene la frase como palabras completas? ("java" NO coincide con "javascript") */
function contienePalabras(texto: string, palabras: string[]): boolean {
  const conEspacios = ` ${texto} `;
  return palabras.every((palabra) => conEspacios.includes(` ${palabra} `));
}

/**
 * Un título coincide si:
 *  - contiene TODAS las palabras de AL MENOS UNA alternativa del rol, y
 *  - no contiene ninguna palabra o frase excluida.
 */
export function coincideConRol(titulo: string, rol: string, excluir: string | undefined): boolean {
  const tituloNormal = normalizar(titulo);

  const excluido = separarLista(excluir).some((frase) => contienePalabras(tituloNormal, frase.split(' ')));
  if (excluido) return false;

  return separarLista(rol).some((alternativa) => contienePalabras(tituloNormal, alternativa.split(' ')));
}

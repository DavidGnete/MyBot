/** Una oferta tal como la leemos de cualquier fuente, ya en nuestro formato común. */
export type OfertaLeida = {
  idExterno: string; // el id que le da el sitio: con él evitamos duplicados
  titulo: string;
  empresa: string;
  ubicacion: string | null;
  url: string; // página de la oferta (en agregadores: SU página, como exigen sus términos)
  publicadaEn: Date | null;
  // urlPostulacion: dónde se postula. En la fase 4 sirve para saber si es Greenhouse/Lever
  datosCrudos: { urlPostulacion: string } & Record<string, unknown>;
};

/** Lo que el buscador sabe y algunos lectores necesitan (los agregadores BUSCAN por rol). */
export type ContextoBusqueda = {
  rol: string;
  pais: string | undefined; // ej. "Colombia": solo ofertas que acepten candidatos de ahí
};

/**
 * Lo que debe saber hacer cada tipo de fuente (Greenhouse, Lever, Remotive...).
 * El buscador solo conoce esta interfaz: agregar un sitio nuevo = un archivo nuevo.
 */
export interface LectorFuente {
  /**
   * Tiempo mínimo entre dos lecturas, INCLUSO con /buscar.
   * Solo debe ser alto si los términos de la API lo exigen (ej. Remotive);
   * si no, uno corto evita repeticiones accidentales sin bloquearte.
   */
  esperaMinimaMinutos: number;
  /**
   * false = no filtrar por las palabras del rol (solo por /excluir).
   * Para fuentes que YA vienen filtradas, como las alertas de correo.
   */
  filtrarPorRol?: boolean;
  /** Comprueba que la fuente existe y devuelve su nombre y cuántas ofertas tiene. */
  verificar(identificador: string): Promise<{ nombre: string; totalOfertas: number }>;
  /** Lee las ofertas publicadas. */
  leerOfertas(fuente: { identificador: string; nombre: string }, contexto: ContextoBusqueda): Promise<OfertaLeida[]>;
}

/** Error al leer una fuente, con un mensaje entendible para mostrar en Telegram. */
export class ErrorFuente extends Error {}

/** Espera un tiempo al azar entre min y max milisegundos. */
export function pausaAleatoria(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolver) => setTimeout(resolver, ms));
}

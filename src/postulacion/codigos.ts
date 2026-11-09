/**
 * Código de verificación que Greenhouse envía a tu correo al postular.
 * El trabajo de envío ESPERA aquí; tu siguiente mensaje en Telegram se lo entrega.
 *
 * Funciona porque el bot y los trabajos corren en el MISMO proceso.
 * A propósito el bot NO lee el código de tu Gmail: la verificación la haces tú
 * (leerlo solo sería saltarse el control de Greenhouse).
 */
let pendiente: { empresa: string; entregar: (codigo: string | null) => void } | undefined;

export function hayCodigoPendiente(): string | undefined {
  return pendiente?.empresa;
}

/** Espera tu código hasta `minutos`. Devuelve null si se acaba el tiempo o cancelas. */
export function esperarCodigo(empresa: string, minutos: number): Promise<string | null> {
  return new Promise((resolver) => {
    const temporizador = setTimeout(() => {
      pendiente = undefined;
      resolver(null);
    }, minutos * 60_000);
    pendiente = {
      empresa,
      entregar: (codigo) => {
        clearTimeout(temporizador);
        pendiente = undefined;
        resolver(codigo);
      },
    };
  });
}

/** Lo llama Telegram con tu mensaje. Devuelve false si no había ningún código esperado. */
export function entregarCodigo(texto: string | null): boolean {
  if (!pendiente) return false;
  pendiente.entregar(texto === null ? null : texto.trim());
  return true;
}

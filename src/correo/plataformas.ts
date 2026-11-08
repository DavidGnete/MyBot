/**
 * Cómo reconocer las alertas de cada portal y los links de ofertas dentro de ellas.
 *
 * OJO: son un PRIMER INTENTO (no teníamos correos reales de ejemplo). Si un portal
 * cambia el formato o usa links de rastreo, ajusta el patrón aquí con ayuda de
 * `npm run correo:diagnostico`.
 */
export type Plataforma = {
  nombre: string;
  remitente: RegExp; // ¿el correo viene de este portal?
  oferta: RegExp; // ¿este link es una oferta?
  /** Id estable de la oferta a partir del link (para no repetirla). */
  idDe: (url: URL) => string | null;
};

const ultimoTramo = (url: URL) => url.pathname.split('/').filter(Boolean).pop() ?? null;

export const PLATAFORMAS: Plataforma[] = [
  {
    nombre: 'Computrabajo',
    remitente: /computrabajo/i,
    oferta: /computrabajo\.com.*(oferta-de-trabajo|ofertas-de-trabajo)/i,
    idDe: (url) => url.pathname.match(/-([A-F0-9]{16,})/i)?.[1] ?? ultimoTramo(url),
  },
  {
    nombre: 'Indeed',
    remitente: /indeed/i,
    oferta: /indeed\.com\/(rc\/clk|viewjob|m\/viewjob|pagead\/clk)|[?&]v?jk=/i,
    idDe: (url) => url.searchParams.get('jk') ?? url.searchParams.get('vjk'),
  },
  {
    nombre: 'elempleo',
    remitente: /elempleo/i,
    oferta: /elempleo\.com.*ofertas?-(de-)?trabajo/i,
    idDe: (url) => url.pathname.match(/(\d{5,})/)?.[1] ?? ultimoTramo(url),
  },
  {
    nombre: 'Magneto',
    remitente: /magneto365/i,
    oferta: /magneto365\.com.*\/(empleos?|jobs?|oferta)/i,
    idDe: ultimoTramo,
  },
  {
    // Regla del proyecto: LinkedIn NO se automatiza; solo te avisamos y postulas tú.
    nombre: 'LinkedIn',
    // SOLO remitentes de empleos (ej. jobalerts-noreply@, jobs-noreply@). LinkedIn también envía
    // boletines e invitaciones de contacto: esos no se deben leer (privacidad).
    remitente: /^[^@]*job[^@]*@linkedin\.com$/i,
    oferta: /linkedin\.com\/(comm\/)?jobs\/view\/\d+/i,
    idDe: (url) => url.pathname.match(/jobs\/view\/(\d+)/)?.[1] ?? null,
  },
];

export function plataformaDelRemitente(direccion: string): Plataforma | undefined {
  return PLATAFORMAS.find((p) => p.remitente.test(direccion));
}

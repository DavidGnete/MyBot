import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';
import { remotive } from './remotive.js';
import { remoteok } from './remoteok.js';
import { himalayas } from './himalayas.js';
import { getonboard } from './getonboard.js';
import { jooble } from './jooble.js';
import { correo } from './correo.js';
import type { LectorFuente } from './tipos.js';

// Tipos de fuente que sabemos leer. Agregar un sitio = una línea aquí + su archivo.
export const LECTORES = {
  greenhouse,
  lever,
  remotive,
  remoteok,
  himalayas,
  getonboard,
  jooble,
  correo,
} satisfies Record<string, LectorFuente>;

export type TipoFuente = keyof typeof LECTORES;

// Los agregadores no son "una empresa": hay una sola fuente de cada uno.
const AGREGADORES: Record<string, TipoFuente> = {
  remotive: 'remotive',
  'remotive.com': 'remotive',
  remoteok: 'remoteok',
  'remoteok.com': 'remoteok',
  himalayas: 'himalayas',
  'himalayas.app': 'himalayas',
};

/**
 * Convierte lo que pegas en Telegram en { tipo, identificador }. Acepta:
 *   https://boards.greenhouse.io/gitlab        https://job-boards.greenhouse.io/gitlab/jobs/123
 *   https://jobs.lever.co/palantir             greenhouse:gitlab   lever:palantir
 *   remotive | remoteok | himalayas  (o sus links)
 */
export function interpretarFuente(texto: string): { tipo: TipoFuente; identificador: string } | null {
  const limpio = texto.trim().toLowerCase();

  const corto = limpio.match(/^(greenhouse|lever):([\w-]+)$/);
  if (corto) return { tipo: corto[1] as TipoFuente, identificador: corto[2]! };

  if (AGREGADORES[limpio]) return { tipo: AGREGADORES[limpio], identificador: 'global' };

  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return null;
  }
  const dominio = url.hostname.replace(/^www\./, '');
  if (AGREGADORES[dominio]) return { tipo: AGREGADORES[dominio], identificador: 'global' };

  const primerTramo = url.pathname.split('/').filter(Boolean)[0];

  if (/(^|\.)greenhouse\.io$/.test(dominio)) {
    // Formato "embed": boards.greenhouse.io/embed/job_board?for=gitlab
    const identificador = url.searchParams.get('for') ?? (primerTramo !== 'embed' ? primerTramo : undefined);
    return identificador ? { tipo: 'greenhouse', identificador } : null;
  }
  if (dominio === 'jobs.lever.co' && primerTramo) {
    return { tipo: 'lever', identificador: primerTramo };
  }
  return null;
}

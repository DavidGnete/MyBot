import { chromium, type Browser, type Page } from '@playwright/test';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Abre un navegador nuevo y limpio para UNA postulación y lo cierra al terminar.
 * Navegador nuevo cada vez = sin cookies ni estado mezclado entre empresas.
 */
export async function conNavegador<T>(trabajo: (pagina: Page) => Promise<T>): Promise<T> {
  const navegador: Browser = await chromium.launch({ headless: !config.NAVEGADOR_VISIBLE });
  try {
    const contexto = await navegador.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    });
    const pagina = await contexto.newPage();
    pagina.setDefaultTimeout(20_000);
    return await trabajo(pagina);
  } finally {
    await navegador.close();
  }
}

/**
 * Ventana VISIBLE en tu PC (modo asistido): el bot llena y TÚ terminas
 * (código del correo, CAPTCHA, clic en Submit). Siempre visible, sin importar NAVEGADOR_VISIBLE.
 * Solo funciona mientras el bot corre en un PC con pantalla (no en un servidor).
 */
export async function conVentanaVisible<T>(trabajo: (pagina: Page) => Promise<T>): Promise<T> {
  const navegador: Browser = await chromium.launch({ headless: false });
  try {
    const contexto = await navegador.newContext({ locale: 'en-US', viewport: null }); // null = tamaño real de la ventana
    const pagina = await contexto.newPage();
    pagina.setDefaultTimeout(20_000);
    return await trabajo(pagina);
  } finally {
    await navegador.close().catch(() => {}); // si ya la cerraste tú, no pasa nada
  }
}

/**
 * MODO SOLO LECTURA: bloquea toda petición que no sea GET.
 * Con esto es IMPOSIBLE enviar el formulario o subir el PDF, aunque algo hiciera clic en "Submit".
 * Se usa en la vista previa (fase 4b): nada sale de tu PC hasta que apruebas.
 */
export async function bloquearEnvios(pagina: Page): Promise<void> {
  await pagina.route('**/*', async (ruta) => {
    const peticion = ruta.request();
    if (peticion.method() === 'GET') return ruta.continue();
    logger.debug({ metodo: peticion.method(), host: new URL(peticion.url()).host }, 'Petición bloqueada (modo solo lectura)');
    return ruta.abort();
  });
}

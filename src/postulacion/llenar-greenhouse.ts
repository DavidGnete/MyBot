import type { Locator, Page } from '@playwright/test';
import { pausaAleatoria } from '../utilidades/pausas.js';
import { logger } from '../logger.js';
import type { Pregunta, Respuesta } from './tipos.js';

/** URL del formulario. El formato "job-boards" es el actual de Greenhouse. */
export function urlFormularioGreenhouse(tablero: string, idOferta: string): string {
  return `https://job-boards.greenhouse.io/${encodeURIComponent(tablero)}/jobs/${encodeURIComponent(idOferta)}`;
}

// Los ids de Greenhouse pueden tener caracteres raros: usamos [id="..."] en vez de #id
const porId = (pagina: Page, id: string): Locator => pagina.locator(`[id="${id}"]`);

/**
 * Menú de selección (react-select): escribe el texto y hace CLIC en la opción exacta.
 * Nunca presionamos Enter: en un formulario, Enter puede enviarlo.
 */
async function elegirOpcion(pagina: Page, campo: string, etiqueta: string): Promise<void> {
  const entrada = porId(pagina, campo);
  await entrada.click();
  await entrada.fill(etiqueta.slice(0, 40)); // filtra la lista; textos muy largos a veces no coinciden
  // Solo las opciones del menú de ESTE campo (react-select las nombra con el id del input)
  const opciones = pagina.locator(`[id^="react-select-${campo}-option-"]`);
  await opciones.first().waitFor({ timeout: 5_000 });

  const textos = (await opciones.allInnerTexts()).map((t) => t.trim());
  const indice = textos.findIndex((t) => t === etiqueta);
  const elegido = indice >= 0 ? indice : textos.findIndex((t) => t.startsWith(etiqueta));
  if (elegido < 0) throw new Error(`no encontré la opción "${etiqueta}"`);
  await opciones.nth(elegido).click();
}

/** ¿El menú de selección tiene un valor elegido? */
async function tieneSeleccion(pagina: Page, campo: string): Promise<boolean> {
  const control = porId(pagina, campo).locator('xpath=ancestor::div[contains(@class,"select__control")]');
  return (await control.locator('[class*="single-value"], [class*="multi-value"]').count()) > 0;
}

export type ResultadoLlenado = { faltantes: string[] };

/**
 * Llena el formulario con tus respuestas.
 * - preguntas: el formulario según la API (nos dice el TIPO de cada campo)
 * - subirCv: false en la vista previa (el PDF no sale de tu PC hasta que apruebes)
 */
export async function llenarGreenhouse(
  pagina: Page,
  preguntas: Pregunta[],
  respuestas: Respuesta[],
  opciones: { subirCv: boolean; paisTelefono: string | undefined },
): Promise<ResultadoLlenado> {
  await pagina.locator('form').first().waitFor();
  // La página es React: si llenamos antes de que termine de cargar su JavaScript ("hidratación"),
  // React reinicia los campos y lo escrito se pierde. Esperamos a que la red quede quieta.
  await pagina.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  const porCampo = new Map(preguntas.map((p) => [p.campo, p]));
  const faltantes: string[] = [];

  for (const respuesta of respuestas) {
    const pregunta = porCampo.get(respuesta.campo);
    if (!pregunta) {
      faltantes.push(`${respuesta.pregunta} (ya no está en el formulario)`);
      continue;
    }
    try {
      if (pregunta.tipo === 'archivo') {
        if (opciones.subirCv) await porId(pagina, pregunta.campo).setInputFiles(respuesta.respuesta);
      } else if (pregunta.tipo === 'opcion') {
        await elegirOpcion(pagina, pregunta.campo, respuesta.respuesta);
      } else if (pregunta.tipo === 'multiple') {
        for (const etiqueta of respuesta.respuesta.split(' | ')) await elegirOpcion(pagina, pregunta.campo, etiqueta);
      } else {
        await porId(pagina, pregunta.campo).fill(respuesta.respuesta);
      }
    } catch (error) {
      logger.warn({ campo: pregunta.campo, err: error }, 'No se pudo llenar un campo');
      faltantes.push(`${pregunta.etiqueta} (${(error as Error).message.split('\n')[0]})`);
    }
    await pausaAleatoria(300, 1200); // ritmo humano: regla del proyecto
  }

  // País del teléfono: campo obligatorio de la página que NO aparece en la API
  const paisTelefono = porId(pagina, 'country');
  if ((await paisTelefono.count()) > 0 && !(await tieneSeleccion(pagina, 'country'))) {
    if (!opciones.paisTelefono) faltantes.push('Country del teléfono (define tu país con /pais)');
    else await elegirOpcion(pagina, 'country', opciones.paisTelefono).catch(() => faltantes.push('Country del teléfono'));
  }

  // Segunda pasada: si algún campo de texto quedó vacío (ej. React lo reinició), se vuelve a llenar
  for (const respuesta of respuestas) {
    const pregunta = porCampo.get(respuesta.campo);
    if (!pregunta || (pregunta.tipo !== 'texto' && pregunta.tipo !== 'parrafo')) continue;
    const campo = porId(pagina, pregunta.campo);
    if ((await campo.count()) > 0 && (await campo.inputValue()).trim() === '') {
      logger.debug({ campo: pregunta.campo }, 'Campo vacío tras llenar: segundo intento');
      await campo.fill(respuesta.respuesta).catch(() => {});
    }
  }

  // Verificación final: ¿quedó vacía alguna obligatoria?
  for (const pregunta of preguntas.filter((p) => p.obligatoria && p.tipo !== 'archivo')) {
    const campo = porId(pagina, pregunta.campo);
    if ((await campo.count()) === 0) continue;
    const llena =
      pregunta.tipo === 'opcion' || pregunta.tipo === 'multiple'
        ? await tieneSeleccion(pagina, pregunta.campo)
        : (await campo.inputValue()).trim().length > 0;
    if (!llena && !faltantes.some((f) => f.startsWith(pregunta.etiqueta))) faltantes.push(`${pregunta.etiqueta} (quedó vacía)`);
  }

  return { faltantes };
}

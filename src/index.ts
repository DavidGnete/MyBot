import type { Bot } from 'grammy';
import { logger } from './logger.js';
import { pool } from './db/cliente.js';
import { crearBot, notificar, enviarArchivo } from './telegram/bot.js';
import { iniciarProgramador } from './trabajos/programador.js';
import { asegurarFuentesPredeterminadas } from './fuentes/predeterminadas.js';

// Himalayas, Remote OK y Remotive quedan activas sin que tengas que registrarlas
await asegurarFuentesPredeterminadas();

// El bot necesita al programador (para /buscar, /llenar) y el programador al bot (para avisar).
// Rompemos el círculo creando primero el programador con funciones que usan
// el bot "cuando ya exista".
let bot: Bot | undefined;
const programador = await iniciarProgramador({
  texto: async (texto) => {
    if (bot) await notificar(bot, texto);
  },
  archivo: async (ruta, leyenda, botones) => {
    if (bot) await enviarArchivo(bot, ruta, leyenda, botones);
  },
});
bot = crearBot({
  buscarAhora: programador.buscarAhora,
  llenarVistaPrevia: programador.llenarVistaPrevia,
  enviar: programador.enviar,
});

// Cierre ordenado: Ctrl+C o Docker deteniendo el contenedor.
// Orden: dejar de recibir mensajes -> terminar trabajos en curso -> cerrar la base de datos.
async function apagar(senal: string) {
  logger.info({ senal }, 'Apagando...');
  await bot?.stop();
  await programador.detener();
  await pool.end();
  process.exit(0);
}
process.once('SIGINT', () => void apagar('SIGINT'));
process.once('SIGTERM', () => void apagar('SIGTERM'));

await bot.start({
  drop_pending_updates: true, // ignora mensajes enviados mientras el bot estaba apagado
  onStart: (info) => logger.info(`Bot @${info.username} escuchando. Escríbele en Telegram.`),
});

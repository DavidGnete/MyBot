import { logger } from './logger.js';
import { pool } from './db/cliente.js';
import { crearBot } from './telegram/bot.js';

const bot = crearBot();

// Cierre ordenado: al presionar Ctrl+C (o cuando Docker detiene el contenedor)
// dejamos de recibir mensajes y cerramos la base de datos antes de salir.
async function apagar(senal: string) {
  logger.info({ senal }, 'Apagando...');
  await bot.stop();
  await pool.end();
  process.exit(0);
}
process.once('SIGINT', () => void apagar('SIGINT'));
process.once('SIGTERM', () => void apagar('SIGTERM'));

await bot.start({
  drop_pending_updates: true, // ignora mensajes enviados mientras el bot estaba apagado
  onStart: (info) => logger.info(`Bot @${info.username} escuchando. Escríbele en Telegram.`),
});

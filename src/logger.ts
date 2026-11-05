import { pino } from 'pino';
import { config } from './config.js';

// En desarrollo: logs legibles y con colores. En producción: JSON (fácil de filtrar).
export const logger = pino({
  level: config.LOG_LEVEL,
  // Por si algún día se registra un objeto con secretos, pino los oculta
  redact: ['*.password', '*.token', '*.apiKey', 'DATABASE_URL'],
  ...(config.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
  }),
});

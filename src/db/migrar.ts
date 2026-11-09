import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './cliente.js';
import { logger } from '../logger.js';

/**
 * Aplica las migraciones pendientes AL ARRANCAR.
 * En el VPS no corremos `npm run db:migrar` a mano: cada vez que despliegas una versión
 * nueva, el bot actualiza la base de datos solo. Si ya está al día, no hace nada.
 */
export async function aplicarMigraciones(): Promise<void> {
  await migrate(db, { migrationsFolder: 'src/db/migraciones' });
  logger.info('Base de datos al día (migraciones aplicadas)');
}

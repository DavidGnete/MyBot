import { sql } from 'drizzle-orm';
import { db, pool } from './cliente.js';
import { logger } from '../logger.js';

// Script de prueba de la Fase 1: ¿conecta? ¿existen las tablas?
try {
  const version = await db.execute(sql`select version()`);
  logger.info({ version: version.rows[0]?.version }, 'Conectado a Postgres');

  const tablas = await db.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `);
  logger.info({ tablas: tablas.rows.map((f) => f.table_name) }, 'Tablas encontradas');
} catch (error) {
  logger.error({ err: error }, 'No se pudo conectar a la base de datos');
  process.exitCode = 1;
} finally {
  await pool.end();
}

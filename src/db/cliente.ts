import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config.js';
import * as esquema from './esquema.js';

// Un "pool" mantiene varias conexiones abiertas y las reutiliza,
// en vez de abrir una nueva por cada consulta.
export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema: esquema });

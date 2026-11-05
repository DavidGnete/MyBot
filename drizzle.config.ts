import { defineConfig } from 'drizzle-kit';

// drizzle-kit corre fuera de nuestra app, así que carga el .env por su cuenta.
try {
  process.loadEnvFile();
} catch {
  // sin .env: generar migraciones no necesita conexión; aplicarlas sí
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/esquema.ts',
  out: './src/db/migraciones',
  dbCredentials: { url: process.env.DATABASE_URL! },
});

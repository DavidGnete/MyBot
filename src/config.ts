import { z } from 'zod';

// En tu PC las variables vienen del archivo .env.
// En el VPS (Docker) vendrán del entorno, así que si no hay .env no pasa nada.
try {
  process.loadEnvFile();
} catch {
  // sin archivo .env: usamos las variables de entorno existentes
}

const esquemaConfig = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().startsWith('postgres://', 'DATABASE_URL debe empezar por postgres://'),
});

const resultado = esquemaConfig.safeParse(process.env);

if (!resultado.success) {
  // Fallar al arrancar con un mensaje claro (sin imprimir los valores, que pueden ser secretos)
  console.error('Configuración inválida en .env:');
  for (const problema of resultado.error.issues) {
    console.error(`  - ${problema.path.join('.')}: ${problema.message}`);
  }
  process.exit(1);
}

export const config = resultado.data;

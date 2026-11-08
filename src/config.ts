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

  // --- Telegram ---
  // Opcionales aquí para que los scripts de base de datos no los exijan;
  // el bot los verifica al arrancar.
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/, 'Formato esperado: 123456:ABC...').optional(),
  // Vacío = todavía no lo conoces (el bot te lo dice con /start)
  TELEGRAM_CHAT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().optional()),

  // --- Fuentes con key ---
  JOOBLE_API_KEY: z.string().min(1).optional(), // gratis en <sitio>/api/about
  // Cada key sirve solo en el sitio del país donde se registró (co.jooble.org = Colombia)
  JOOBLE_SITIO: z.string().regex(/^([a-z]{2}\.)?jooble\.org$/, 'Ej: co.jooble.org').default('co.jooble.org'),

  // --- Correo de alertas (Gmail por IMAP, solo lectura) ---
  CORREO_IMAP_HOST: z.string().default('imap.gmail.com'),
  CORREO_USUARIO: z.email().optional(),
  // Contraseña de APLICACIÓN de Gmail (16 letras), NO tu contraseña normal. Se ignoran los espacios.
  CORREO_CLAVE_APP: z.string().min(1).transform((v) => v.replace(/\s+/g, '')).optional(),

  // --- Postulación ---
  // Máximo de postulaciones ENVIADAS por día (hora Colombia)
  LIMITE_DIARIO: z.coerce.number().int().positive().default(10),

  // --- Navegador (Playwright) ---
  // true = ves la ventana mientras llena el formulario (útil para aprender/depurar)
  NAVEGADOR_VISIBLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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

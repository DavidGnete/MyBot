import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { Pregunta, Respuesta } from '../postulacion/tipos.js';

// ---------- Enums: los valores posibles quedan fijados en la base de datos ----------

export const tipoFuente = pgEnum('tipo_fuente', [
  'greenhouse',
  'lever',
  'correo',
  'navegador',
  // agregadores: buscan el rol en muchas empresas a la vez
  'remotive',
  'remoteok',
  'himalayas',
]);

export const estadoOferta = pgEnum('estado_oferta', [
  'nueva', // recién detectada, sin filtrar
  'descartada', // la descartaste tú (no aplica)
  'apta', // encaja, lista para postular
  'postulando', // en proceso (evita que dos trabajos la tomen a la vez)
  'postulada', // enviada con éxito
  'pendiente', // falta información del perfil: te pregunta por Telegram
  'manual', // la haces tú (ej. LinkedIn)
  'pausada', // CAPTCHA o control anti-bot detectado
  'error',
]);

export const estadoPostulacion = pgEnum('estado_postulacion', [
  'en_progreso',
  'enviada',
  'pendiente',
  'error',
]);

export const idiomaCv = pgEnum('idioma_cv', ['es', 'en']);

const marcasDeTiempo = {
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------- ajustes: configuración que cambias desde Telegram (ej. el rol) ----------

export const ajustes = pgTable('ajustes', {
  clave: text('clave').primaryKey(), // ej. "rol"
  valor: text('valor').notNull(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ---------- fuentes: los sitios que el agente monitorea ----------

export const fuentes = pgTable('fuentes', {
  id: serial('id').primaryKey(),
  nombre: text('nombre').notNull(), // ej. "Empresa X (Greenhouse)"
  tipo: tipoFuente('tipo').notNull(),
  identificador: text('identificador').notNull(), // ej. el "board token" de Greenhouse
  activa: boolean('activa').notNull().default(true),
  limiteDiario: integer('limite_diario').notNull().default(10), // postulaciones máximas por día
  pausadaHasta: timestamp('pausada_hasta', { withTimezone: true }), // tras un CAPTCHA
  revisadaEn: timestamp('revisada_en', { withTimezone: true }), // última lectura exitosa (para respetar límites de cada API)
  ...marcasDeTiempo,
}, (t) => [uniqueIndex('fuentes_tipo_identificador_uq').on(t.tipo, t.identificador)]);

// ---------- ofertas: cada vacante detectada ----------

export const ofertas = pgTable('ofertas', {
  id: serial('id').primaryKey(),
  fuenteId: integer('fuente_id').notNull().references(() => fuentes.id),
  idExterno: text('id_externo').notNull(), // el id que le da el sitio de origen
  titulo: text('titulo').notNull(),
  empresa: text('empresa').notNull(),
  ubicacion: text('ubicacion'),
  url: text('url').notNull(),
  descripcion: text('descripcion'),
  publicadaEn: timestamp('publicada_en', { withTimezone: true }),
  estado: estadoOferta('estado').notNull().default('nueva'),
  razonFiltro: text('razon_filtro'), // sin uso por ahora (venía del diseño con IA, descartado)
  datosCrudos: jsonb('datos_crudos'), // respuesta original del sitio, por si la necesitamos
  ...marcasDeTiempo,
}, (t) => [
  // REGLA: nunca la misma oferta dos veces. La base de datos lo garantiza, no el código.
  uniqueIndex('ofertas_fuente_id_externo_uq').on(t.fuenteId, t.idExterno),
  index('ofertas_estado_idx').on(t.estado),
]);

// ---------- postulaciones: el intento de postular a una oferta ----------

export const postulaciones = pgTable('postulaciones', {
  id: serial('id').primaryKey(),
  ofertaId: integer('oferta_id').notNull().references(() => ofertas.id),
  // pendiente = esperando tus respuestas por Telegram; en_progreso = respuestas completas, lista para llenar (4b)
  estado: estadoPostulacion('estado').notNull().default('en_progreso'),
  idiomaCv: idiomaCv('idioma_cv'),
  respuestas: jsonb('respuestas').$type<Respuesta[]>().notNull().default([]),
  // La primera de la lista es la que se te está preguntando ahora
  preguntasPendientes: jsonb('preguntas_pendientes').$type<Pregunta[]>().notNull().default([]),
  rutaCaptura: text('ruta_captura'), // captura antes de enviar (Playwright)
  error: text('error'),
  enviadaEn: timestamp('enviada_en', { withTimezone: true }),
  ...marcasDeTiempo,
}, (t) => [
  // REGLA: una sola postulación por oferta.
  uniqueIndex('postulaciones_oferta_uq').on(t.ofertaId),
]);

// ---------- respuestas_guardadas: lo que respondiste, para no volver a preguntarlo ----------

export const respuestasGuardadas = pgTable('respuestas_guardadas', {
  id: serial('id').primaryKey(),
  clave: text('clave').notNull(), // la pregunta normalizada: "linkedin profile"
  pregunta: text('pregunta').notNull(), // tal como apareció la primera vez
  respuesta: text('respuesta').notNull(),
  ...marcasDeTiempo,
}, (t) => [uniqueIndex('respuestas_guardadas_clave_uq').on(t.clave)]);

CREATE TYPE "public"."estado_oferta" AS ENUM('nueva', 'descartada', 'apta', 'postulando', 'postulada', 'pendiente', 'manual', 'pausada', 'error');--> statement-breakpoint
CREATE TYPE "public"."estado_postulacion" AS ENUM('en_progreso', 'enviada', 'pendiente', 'error');--> statement-breakpoint
CREATE TYPE "public"."idioma_cv" AS ENUM('es', 'en');--> statement-breakpoint
CREATE TYPE "public"."tipo_fuente" AS ENUM('greenhouse', 'lever', 'correo', 'navegador');--> statement-breakpoint
CREATE TABLE "fuentes" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_fuente" NOT NULL,
	"identificador" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"limite_diario" integer DEFAULT 10 NOT NULL,
	"pausada_hasta" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ofertas" (
	"id" serial PRIMARY KEY NOT NULL,
	"fuente_id" integer NOT NULL,
	"id_externo" text NOT NULL,
	"titulo" text NOT NULL,
	"empresa" text NOT NULL,
	"ubicacion" text,
	"url" text NOT NULL,
	"descripcion" text,
	"publicada_en" timestamp with time zone,
	"estado" "estado_oferta" DEFAULT 'nueva' NOT NULL,
	"razon_filtro" text,
	"datos_crudos" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postulaciones" (
	"id" serial PRIMARY KEY NOT NULL,
	"oferta_id" integer NOT NULL,
	"estado" "estado_postulacion" DEFAULT 'en_progreso' NOT NULL,
	"idioma_cv" "idioma_cv",
	"respuestas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preguntas_pendientes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ruta_captura" text,
	"error" text,
	"enviada_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ofertas" ADD CONSTRAINT "ofertas_fuente_id_fuentes_id_fk" FOREIGN KEY ("fuente_id") REFERENCES "public"."fuentes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postulaciones" ADD CONSTRAINT "postulaciones_oferta_id_ofertas_id_fk" FOREIGN KEY ("oferta_id") REFERENCES "public"."ofertas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuentes_tipo_identificador_uq" ON "fuentes" USING btree ("tipo","identificador");--> statement-breakpoint
CREATE UNIQUE INDEX "ofertas_fuente_id_externo_uq" ON "ofertas" USING btree ("fuente_id","id_externo");--> statement-breakpoint
CREATE INDEX "ofertas_estado_idx" ON "ofertas" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "postulaciones_oferta_uq" ON "postulaciones" USING btree ("oferta_id");
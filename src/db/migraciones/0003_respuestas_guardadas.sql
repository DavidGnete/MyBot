CREATE TABLE "respuestas_guardadas" (
	"id" serial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"pregunta" text NOT NULL,
	"respuesta" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "respuestas_guardadas_clave_uq" ON "respuestas_guardadas" USING btree ("clave");
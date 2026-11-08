ALTER TYPE "public"."tipo_fuente" ADD VALUE 'remotive';--> statement-breakpoint
ALTER TYPE "public"."tipo_fuente" ADD VALUE 'remoteok';--> statement-breakpoint
ALTER TYPE "public"."tipo_fuente" ADD VALUE 'himalayas';--> statement-breakpoint
ALTER TABLE "fuentes" ADD COLUMN "revisada_en" timestamp with time zone;
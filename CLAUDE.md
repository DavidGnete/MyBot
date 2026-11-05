# Agente de postulación a empleos

Proyecto personal de aprendizaje. Claude actúa como **mentor técnico**: explica el porqué de cada decisión, escribe el código junto al usuario y **no avanza de fase hasta que el usuario confirme que la fase actual funciona**.

## Objetivo
1. Recibir el perfil del usuario (datos, experiencia, respuestas preaprobadas) y sus hojas de vida en PDF (español e inglés).
2. Monitorear periódicamente las fuentes de empleo registradas.
3. Filtrar con un LLM las ofertas que encajan con el cargo buscado.
4. Postular automáticamente, respondiendo los formularios SOLO con información del perfil.
5. Notificar por Telegram cada postulación: cargo, empresa, sitio y link.
6. Si una pregunta no tiene respuesta en el perfil, NO inventar: la oferta queda en estado `pendiente` y se le pregunta al usuario por Telegram.

## Stack (no cambiar sin consultar al usuario)
- Node.js + TypeScript
- PostgreSQL + Drizzle ORM
- pg-boss para trabajos programados y colas (sin Redis)
- Claude API con `@anthropic-ai/sdk`: `claude-haiku-5-5` para filtrar ofertas, `claude-sonnet-5-5` para llenar formularios
- Zod para validar las salidas JSON del LLM (y el `.env` y el perfil)
- Playwright para sitios sin API
- `fetch` nativo para fuentes con API pública (Greenhouse, Lever)
- grammY para el bot de Telegram
- pino para logs
- Docker + docker-compose para correr en un VPS

## Reglas obligatorias
- **Secretos:** ninguna API key, contraseña o token en el código ni en el repositorio. Todo va en `.env`, que está en `.gitignore`. Mantener un `.env.example` con valores ficticios.
- **Datos personales:** `perfil.json` real, hojas de vida PDF y capturas de pantalla también se excluyen del repositorio (`datos/` y `capturas/` en `.gitignore`). En el repo solo hay un perfil de ejemplo con datos ficticios.
- **Confidencialidad laboral:** el agente nunca menciona el nombre de la empresa cliente donde trabaja actualmente el usuario ni dice que revisa código. Esta regla va en el perfil y en el prompt del LLM. El nombre real nunca se escribe en el código ni en este archivo; si hace falta para un filtro de salida, se lee desde `.env`.
- **Anti-bot:** no evadir CAPTCHAs ni controles anti-bot. Si aparecen, pausar esa fuente y notificar por Telegram.
- **LinkedIn:** NO se automatiza con navegador. Sus ofertas se detectan leyendo los correos de alertas de empleo y quedan en cola para que el usuario postule manualmente.
- **Ritmo:** límite diario configurable de postulaciones por sitio y pausas aleatorias entre acciones.
- **Sin duplicados:** nunca postular dos veces a la misma oferta (índice único por fuente + id externo).
- **Trazabilidad:** cada respuesta generada por el LLM indica de qué campo del perfil sale. Si no hay fuente, la oferta queda `pendiente`.
- **Evidencia:** guardar una captura de pantalla antes de enviar cada formulario con Playwright.

## Estados de una oferta
`nueva` → `descartada` | `apta` → `postulando` → `postulada` | `pendiente` (falta información) | `manual` (LinkedIn u otros que hace el usuario) | `pausada` (CAPTCHA o anti-bot) | `error`

## Fases (una a la vez, con confirmación del usuario)
- [x] **Fase 0 — Plan:** estructura de carpetas y este CLAUDE.md.
- [ ] **Fase 1 — Esqueleto:** proyecto TypeScript, docker-compose con Postgres, conexión a la base de datos y esquema Drizzle (`fuentes`, `ofertas`, `postulaciones`) con su migración.
- [ ] **Fase 2 — Perfil:** `perfil.ejemplo.json` con datos ficticios y su esquema Zod.
- [ ] **Fase 3 — Primer monitor:** trabajo de pg-boss que cada hora consulta una fuente de Greenhouse o Lever y guarda las ofertas nuevas sin duplicados. Sin LLM.
- [ ] **Fase 4 — Notificador:** bot de Telegram que avisa de las ofertas nuevas y envía un resumen diario de "sigo vivo".
- [ ] **Fase 5 — Filtro LLM:** Haiku decide si cada oferta encaja; responde `{ encaja, razon }` validado con Zod.
- [ ] **Fase 6 — Postulación por API:** Sonnet mapea las preguntas del formulario al perfil, se valida y se envía. Las preguntas sin respuesta pasan a `pendiente` y el usuario responde desde Telegram.
- [ ] **Fase 7 — Postulación con navegador:** postulador Playwright para un sitio que elija el usuario, con capturas y manejo de errores.
- [ ] **Fase 8 — Lector de alertas por correo:** detectar ofertas de LinkedIn y otros portales.
- [ ] **Fase 9 — Despliegue:** Dockerfile basado en la imagen oficial de Playwright, reinicio automático e instrucciones para el VPS.

## Forma de trabajar
- Al inicio de cada fase: explicar en pocas líneas qué se hará y por qué.
- Archivos pequeños con nombres claros (en español).
- Al terminar cada fase: dar el comando exacto para probarla y el resultado esperado.
- Si algo falla, depurarlo antes de seguir.
- Ante dudas sobre preferencias del usuario, preguntar en vez de suponer.
- Actualizar la casilla de la fase en este archivo cuando el usuario la confirme.

## Estructura de carpetas
```
Bot/
├── CLAUDE.md
├── .env.example            # valores ficticios
├── .gitignore              # .env, datos/, capturas/, node_modules/...
├── docker-compose.yml      # postgres (+ app en fase 9)
├── Dockerfile              # fase 9
├── drizzle.config.ts
├── package.json / tsconfig.json
├── datos/                  # NO se sube: perfil.json, cv-es.pdf, cv-en.pdf
├── capturas/               # NO se sube: evidencia antes de enviar formularios
└── src/
    ├── index.ts            # arranque: db + pg-boss + bot
    ├── config.ts           # lee y valida .env con Zod
    ├── logger.ts           # pino
    ├── db/                 # cliente.ts, esquema.ts, migraciones/
    ├── perfil/             # esquema.ts, cargar.ts, perfil.ejemplo.json
    ├── fuentes/            # tipos.ts, greenhouse.ts, lever.ts, correo.ts
    ├── trabajos/           # programador.ts, monitorear.ts, filtrar.ts, postular.ts, resumen-diario.ts
    ├── llm/                # cliente.ts, prompts.ts, filtro.ts, formulario.ts
    ├── postuladores/       # tipos.ts, api-*.ts, navegador/<sitio>.ts
    ├── telegram/           # bot.ts, notificaciones.ts, pendientes.ts
    └── utilidades/         # limites.ts, pausas.ts
```

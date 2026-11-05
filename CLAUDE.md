# Postulador automático de empleo

Proyecto personal de aprendizaje. Claude actúa como **mentor técnico**: explica el porqué de cada decisión, escribe el código junto al usuario y **no avanza de fase hasta que el usuario confirme que la fase actual funciona**.

## Objetivo (versión simple, decidida por el usuario el 2026-11-05)
1. Tener la hoja de vida del usuario en PDF (español y/o inglés), que él envía por Telegram.
2. Buscar periódicamente ofertas del **rol** que el usuario indique, en las **fuentes que él registre**.
3. Postular con Playwright: abrir el formulario, subir el PDF tal cual y enviar.
4. Si el formulario tiene preguntas (incluye nombre, correo, teléfono…), preguntarlas por Telegram **antes** de enviar, y **recordar** cada respuesta por el texto de la pregunta para no repetirla.
5. Notificar por Telegram cada postulación: cargo, empresa, sitio y link.

**Sin IA:** el PDF no se lee, no se extrae texto, no se usa LLM. El filtrado es por palabras clave del título. (Una versión anterior con LLM se descartó y nunca se versionó.)

## Stack (no cambiar sin consultar al usuario)
- Node.js + TypeScript (ESM, `tsx`)
- PostgreSQL + Drizzle ORM
- pg-boss para trabajos programados y colas (sin Redis)
- Playwright para postular (formularios)
- `fetch` nativo para leer ofertas de fuentes con API pública (Greenhouse, Lever)
- grammY para el bot de Telegram (long polling)
- Zod para validar `.env` y datos externos
- pino para logs
- Docker + docker-compose para correr en un VPS

## Reglas obligatorias
- **Secretos:** ningún token, contraseña o key en el código ni en el repositorio. Todo va en `.env` (en `.gitignore`). Mantener `.env.example` con valores ficticios.
- **Datos personales:** PDF, respuestas guardadas y capturas no se suben al repo (`datos/` y `capturas/` en `.gitignore`). Claude Code no lee `datos/` ni `.env`; diagnostica con comandos que oculten valores.
- **Bot privado:** el bot de Telegram solo obedece al chat id del usuario (`TELEGRAM_CHAT_ID`). Cualquier otro chat se ignora.
- **Confidencialidad laboral:** nunca escribir el nombre de la empresa cliente donde trabaja el usuario en el código, prompts ni este archivo.
- **Anti-bot:** no evadir CAPTCHAs ni controles anti-bot. Si aparecen, pausar esa postulación y enviar el link al usuario para que postule manualmente.
- **LinkedIn:** NO se automatiza.
- **Ritmo:** límite diario configurable de postulaciones por sitio y pausas aleatorias entre acciones.
- **Sin duplicados:** nunca postular dos veces a la misma oferta (índice único fuente + id externo; una postulación por oferta).
- **Evidencia:** captura de pantalla antes de enviar cada formulario.

## Estados de una oferta
`nueva` → `descartada` | `apta` → `postulando` → `postulada` | `pendiente` (esperando respuestas por Telegram) | `manual` (CAPTCHA, login u otro bloqueo: la hace el usuario) | `error`

## Fases (una a la vez, con confirmación del usuario)
- [x] **Fase 0 — Plan.**
- [x] **Fase 1 — Esqueleto:** TypeScript, Postgres en Docker (puerto 5430), Drizzle con `fuentes`, `ofertas`, `postulaciones`.
- [x] **Fase 2 — Bot de Telegram:** recibe el PDF (pregunta idioma es/en) y lo guarda en `datos/`; `/rol` define el rol buscado; `/estado`; solo responde al chat del usuario.
- [ ] **Fase 3 — Buscador:** trabajo pg-boss cada hora; lee ofertas de fuentes Greenhouse/Lever registradas, filtra por palabras del rol, guarda sin duplicados y avisa por Telegram. Comandos para registrar fuentes.
- [ ] **Fase 4 — Postulador Greenhouse/Lever (Playwright):** detecta campos del formulario, pregunta por Telegram los que no tienen respuesta guardada, llena, captura, sube PDF (inglés si existe), envía y notifica. CAPTCHA → `manual`.
- [ ] **Fase 5 — Portales colombianos:** evaluar uno (Computrabajo, elempleo, Magneto…): requieren login (credenciales en `.env`) y revisar sus términos de uso antes de automatizar.
- [ ] **Fase 6 — Despliegue:** Dockerfile basado en la imagen oficial de Playwright, reinicio automático, instrucciones para el VPS.

## Forma de trabajar
- Al inicio de cada fase: explicar en pocas líneas qué se hará y por qué.
- Archivos pequeños con nombres claros (en español).
- Al terminar cada fase: comando exacto para probarla y resultado esperado.
- Si algo falla, depurarlo antes de seguir.
- Ante dudas sobre preferencias del usuario, preguntar en vez de suponer.
- Marcar la casilla de la fase cuando el usuario la confirme.

## Notas del entorno local
- El usuario tiene otros contenedores Docker (uno ocupa el puerto 5432). El Postgres del bot usa `POSTGRES_PORT=5430`, definido solo en `.env`.
- Windows + PowerShell. Repo en GitHub (`DavidGnete/MyBot`).

## Estructura de carpetas
```
Bot/
├── CLAUDE.md, .env.example, .gitignore, docker-compose.yml, drizzle.config.ts
├── datos/          # NO se sube: cv-es.pdf, cv-en.pdf
├── capturas/       # NO se sube: evidencia antes de enviar
└── src/
    ├── index.ts    # arranque: bot + (fase 3) pg-boss
    ├── config.ts   # valida .env con Zod
    ├── logger.ts   # pino
    ├── ajustes.ts  # rol buscado y otros ajustes (tabla ajustes)
    ├── hojas-de-vida.ts  # dónde están los PDF
    ├── db/         # cliente.ts, esquema.ts, migraciones/
    ├── telegram/   # bot.ts, comandos.ts, recibir-pdf.ts
    ├── fuentes/    # (fase 3) greenhouse.ts, lever.ts
    ├── trabajos/   # (fase 3) programador.ts, buscar.ts
    └── postuladores/  # (fase 4) greenhouse.ts, lever.ts
```

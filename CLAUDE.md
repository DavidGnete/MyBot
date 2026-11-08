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
- [x] **Fase 3 — Buscador:** trabajo pg-boss cada hora; lee ofertas de fuentes Greenhouse/Lever registradas, filtra por palabras del rol, guarda sin duplicados y avisa por Telegram. Comandos para registrar fuentes.
- [x] **Fase 3b — Agregadores:** Remotive (cada 6 h), Remote OK y Himalayas (cada 1 h; filtra por `/pais`). Se activan solos al arrancar (`fuentes/predeterminadas.ts`); el usuario no quiere registrar fuentes a mano — `/fuente` queda como opción extra. Cada lector declara `esperaMinimaMinutos` (tiempo mínimo entre lecturas, también con /buscar), controlado con `fuentes.revisada_en`: 360 en Remotive por sus términos, 5 en el resto para no bloquear al usuario al cambiar de rol. Términos: mostrar "vía <fuente>" y enlazar SU página; en Himalayas postular solo por su `applicationLink`. Sus ofertas casi siempre serán `manual` en la fase 4 (salvo que `datosCrudos.urlPostulacion` apunte a Greenhouse/Lever).
- [ ] **Fase 4 — Postulador Greenhouse (Playwright).** Decisiones del usuario (2026-11-08): aprobar CADA envío con botón; preguntas abiertas se preguntan por Telegram; Greenhouse primero, Lever después.
  - [x] **4a — Preguntas:** `/ofertas`, `/postular_N`. Preguntas desde la API `boards/{t}/jobs/{id}?questions=true`. Solo se preguntan las obligatorias; reutiliza respuestas de `texto`/`opcion`/`multiple` (tabla `respuestas_guardadas`, clave = etiqueta normalizada); los `parrafo` nunca se reutilizan. Una postulación pidiendo respuestas a la vez. Ofertas de agregadores sirven si su `urlPostulacion` es de Greenhouse.
  - [x] **4b — Vista previa (solo lectura):** cola pg-boss `vista-previa`; `/llenar_N` (N = id de oferta). `bloquearEnvios()` aborta TODA petición no-GET → imposible enviar o subir el PDF. Captura del `<form>` enviada como documento. Aprendizajes de Greenhouse:
    - Subir el archivo hace un POST a S3 de Greenhouse AL SELECCIONARLO (antes de "Submit") → en vista previa NO se sube; el PDF se adjunta solo al aprobar (4c).
    - Menús = react-select: opciones en `[id^="react-select-<campo>-option-"]`; elegir con CLIC, nunca Enter.
    - Campo `country` (país del teléfono) obligatorio y NO está en la API → se toma de `/pais`.
    - React hidrata tarde: esperar `networkidle` y hacer una segunda pasada a campos de texto vacíos.
    - Código pasado a `page.evaluate` no debe tener funciones con nombre (tsx inyecta `__name`); preferir locators.
  - [ ] **4c — Envío:** botones [Enviar]/[Cancelar] bajo la vista previa (solo si quedó completa); cola `enviar-postulacion` sin reintentos. Candado atómico oferta `apta→postulando`. `LIMITE_DIARIO` (10) cuenta postulaciones `enviada` desde medianoche Colombia. PDF subido como "Resume.pdf"/"Hoja de vida.pdf"; si la subida no se ve en 30 s NO se envía. Evidencia `capturas/envio-N-antes.png` y `-despues.png`. Éxito solo con señal positiva NUEVA (URL `/confirmation` o texto de agradecimiento que no estaba antes); si no → `manual` + aviso de revisar el correo antes de repostular.
  - Resultado del primer envío real (2026-11-08, Clara): tras Submit, Greenhouse pidió un **código de verificación enviado al correo** → el envío headless NO se completó. Por eso el envío automático se reemplazó por el modo asistido (4d).
  - [ ] **4d — Modo asistido (ACTUAL, decisión del usuario):** botón [🖥️ Abrir en mi PC para enviar] → cola `envio-asistido` (expireInSeconds 1800) → `conVentanaVisible()` abre Chrome visible, llena todo, adjunta el PDF elegido EN ESE MOMENTO, guarda evidencia, deja Submit a la vista y espera hasta 20 min a que el usuario escriba el código del correo / resuelva el CAPTCHA / haga Submit. Confirmada solo con `/confirmation` o texto de éxito nuevo. El bot NO hace clic en Submit. Requiere que el bot corra en un PC con pantalla (impacta la Fase 6). `/postular_N` sobre una postulación en `error` la reabre. `/editar_N` cambia una respuesta guardada y la propaga a postulaciones no enviadas. **El usuario pidió resolver CAPTCHAs con Bright Data (2026-11-08): se rechazó** (regla del proyecto, política de la organización, términos de Greenhouse y riesgo de que descarten sus postulaciones). No implementar servicios de resolución de CAPTCHA.
- [ ] **Fase 5 — Portales con inicio de sesión** (Computrabajo, elempleo, Magneto…; revisar términos antes). Decisión del usuario (2026-11-08): **NO credenciales en `.env`**. El bot abre una ventana VISIBLE de Playwright en el PC del usuario SOLO para sitios que exigen login; el usuario inicia sesión ahí una vez y se guarda la sesión (`storageState` en `datos/sesiones/<sitio>.json`, fuera de git) para reutilizarla. Si la sesión expira, avisar por Telegram para repetir el login.
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

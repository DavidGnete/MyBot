# Despliegue en el VPS (Hetzner CX23) — 24/7

Guía para subir el bot a la nube. Tiempo estimado: 45–60 min la primera vez.

> **Regla de oro:** un bot de Telegram solo puede correr en UN lugar a la vez.
> Antes de arrancarlo en el VPS, **detén el de tu PC** (`Ctrl+C` en `npm run dev`).
> Si corren los dos, Telegram responde `409 Conflict` y ninguno funciona bien.

---

## 0. Antes de empezar (en tu PC)

- [ ] Haz **commit y push** de todo: `git add . ; git commit -m "Listo para VPS" ; git push`
- [ ] Ten a mano (NO los pegues en ningún chat): tu `.env` y tus PDF de `datos/`.
- [ ] Revisa que el repo de GitHub sea **privado**.

## 1. Crear el servidor en Hetzner

1. Crea una cuenta en <https://www.hetzner.com/cloud> y un proyecto.
2. **Crea una llave SSH en tu PC** (PowerShell), si no tienes una:
   ```powershell
   ssh-keygen -t ed25519 -C "vps-bot-empleo"
   # Enter en todo (o ponle una frase de seguridad). Se guarda en C:\Users\<tú>\.ssh\
   Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub   # esto es lo que pegas en Hetzner
   ```
3. En Hetzner → **Add Server**:
   - Imagen: **Ubuntu 24.04**
   - Tipo: **CX23** (2 vCPU, 4 GB). Si no está disponible, el siguiente más barato con ≥ 2 GB de RAM.
   - SSH key: pega tu llave **pública** (`.pub`). Así no hay contraseña de root que robar.
   - Firewall: crea uno que permita **solo entrada TCP 22 (SSH)**. El bot no necesita puertos abiertos: él sale a internet, nadie entra a él.
4. Copia la IP del servidor.

## 2. Preparar el servidor

```powershell
ssh root@IP_DEL_SERVIDOR
```
Ya dentro del servidor:
```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh          # instala Docker + docker compose
timedatectl set-timezone America/Bogota          # logs en hora Colombia
apt install -y unattended-upgrades               # parches de seguridad automáticos
```

## 3. Traer el código (repo privado)

Usa una **deploy key** (llave de solo lectura para ESTE repo):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_bot -N ""
cat ~/.ssh/deploy_bot.pub
```
En GitHub → repo → *Settings → Deploy keys → Add deploy key* → pega la llave → **sin** permiso de escritura.
```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy_bot
EOF
git clone git@github.com:DavidGnete/MyBot.git /opt/bot
cd /opt/bot
mkdir -p datos capturas && chown -R 1000:1000 datos capturas   # el contenedor corre como usuario 1000
```

## 4. Subir tus secretos y tus PDF (desde tu PC, otra ventana de PowerShell)

```powershell
scp .env root@IP_DEL_SERVIDOR:/opt/bot/.env
scp datos\cv-es.pdf datos\cv-en.pdf root@IP_DEL_SERVIDOR:/opt/bot/datos/
```
Luego, en el servidor:
```bash
chown 1000:1000 /opt/bot/datos/*.pdf
chmod 600 /opt/bot/.env          # solo root puede leer los secretos
```

### 4.1 Ajustar el `.env` del servidor
```bash
nano /opt/bot/.env
```
- **Cambia `POSTGRES_PASSWORD`** por una clave larga y aleatoria (en el VPS no uses `123456`).
  Genera una así: `openssl rand -hex 24` (solo letras y números: no rompe la URL de conexión).
- `DATABASE_URL` puede quedarse como está: en el VPS el `docker-compose.yml` la reemplaza para la app.
- Deja `NAVEGADOR_VISIBLE=false`.

## 5. (Opcional, recomendado) Llevar tu base de datos actual

Así conservas tus **respuestas guardadas**, ofertas ya vistas e historial (si no, el VPS empieza de cero).

En tu PC (con Docker abierto):
```powershell
docker compose exec -T postgres pg_dump -U agente -d agente_empleo --no-owner > respaldo.sql
scp respaldo.sql root@IP_DEL_SERVIDOR:/opt/bot/
Remove-Item respaldo.sql      # contiene datos personales: no lo dejes por ahí
```
En el servidor (DESPUÉS de arrancar solo Postgres):
```bash
cd /opt/bot
docker compose up -d postgres
docker compose exec -T postgres psql -U agente -d agente_empleo < respaldo.sql
rm respaldo.sql
```
> Si cambiaste `POSTGRES_USER`/`POSTGRES_DB`, usa los tuyos en los comandos.

## 6. Arrancar el bot 24/7

**Primero detén el bot de tu PC.** Luego, en el servidor:
```bash
cd /opt/bot
docker compose --profile produccion up -d --build
docker compose logs -f app       # Ctrl+C para salir de los logs (el bot sigue corriendo)
```
✅ Debes ver, en orden: `Base de datos al día`, `Programador listo…`, `Bot @MyFireJob_bot escuchando`.

En Telegram: `/estado` y `/buscar` deben responder.

`restart: unless-stopped` hace que el bot (y Postgres) vuelvan solos si se caen o si el VPS se reinicia.

## 7. Operación diaria

| Quiero… | Comando (en `/opt/bot`) |
|---|---|
| Ver logs | `docker compose logs -f app` |
| Reiniciar | `docker compose restart app` |
| Actualizar a una versión nueva | `git pull && docker compose --profile produccion up -d --build` |
| Detener | `docker compose --profile produccion down` (tus datos quedan en el volumen) |
| Respaldo de la base de datos | `docker compose exec -T postgres pg_dump -U agente -d agente_empleo > respaldo-$(date +%F).sql` |

## Qué cambia respecto a tu PC

- **No hay ventanas** (un servidor no tiene pantalla):
  - Ofertas ✋: `/abrir_N` te manda el link para abrirlo en TU navegador y registra si postulaste.
  - Greenhouse: el bot envía solo; si pide el **código de tu correo**, te lo pregunta por Telegram.
- Si Greenhouse muestra un **CAPTCHA visible**, la oferta queda como manual (no se evade).

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `409 Conflict` en los logs | El bot sigue corriendo en tu PC: detenlo |
| `password authentication failed` | `POSTGRES_PASSWORD` cambió después de crear el volumen. Opción: `docker compose down -v` (BORRA la base) y vuelve a arrancar, o cambia la clave con `ALTER USER` |
| `Cannot find module` al arrancar | La imagen no tiene las devDependencies: el `Dockerfile` debe usar `npm ci --include=dev` |
| Chromium falla al abrir | Revisa que `docker-compose.yml` tenga `init: true` e `ipc: host` |
| No llegan alertas de correo | La contraseña de aplicación de Gmail se revocó: crea otra y actualiza `.env` |

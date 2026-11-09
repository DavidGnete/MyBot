# Imagen OFICIAL de Playwright: trae Chromium y todas sus librerías de sistema.
# La versión DEBE coincidir con @playwright/test en package.json (1.64.1);
# si actualizas uno, actualiza el otro.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
ENV NODE_ENV=production

# 1) Primero solo las dependencias: Docker reutiliza esta capa si package*.json no cambió
#    (los despliegues siguientes son mucho más rápidos).
#    Instalamos TODAS (incluye tsx y @playwright/test, que el bot usa al correr).
#    --include=dev es necesario: con NODE_ENV=production, npm omitiría las devDependencies.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

# 2) Luego el código
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src

# Usuario sin privilegios (viene en la imagen): si algo fallara, no tiene poder de root
RUN mkdir -p datos capturas && chown -R pwuser:pwuser /app
USER pwuser

CMD ["npx", "tsx", "src/index.ts"]

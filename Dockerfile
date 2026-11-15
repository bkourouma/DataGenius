# syntax=docker/dockerfile:1
# Cibles : `app` (sortie standalone allégée) et `outils` (node_modules complets + sources :
# prisma migrate deploy, worker de synchronisation, création d'utilisateur).

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && apt-get clean
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM base AS build
# Valeurs factices : lues seulement pendant `next build`, jamais conservées dans les images finales.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ARG NEXTAUTH_SECRET=secret-factice-de-build
ARG NEXTAUTH_URL=http://localhost:3120
ENV DATABASE_URL=$DATABASE_URL NEXTAUTH_SECRET=$NEXTAUTH_SECRET NEXTAUTH_URL=$NEXTAUTH_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npx prisma generate && npm run build

FROM base AS outils
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
CMD ["npm", "run", "warehouse:worker"]

FROM base AS app
ENV NODE_ENV=production PORT=3120 HOSTNAME=0.0.0.0 UPLOAD_DIR=/data/uploads
RUN mkdir -p /data/uploads && chown node:node /data/uploads
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Filet de sécurité : client Prisma généré et polices pdfmake (lues à l'exécution).
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build --chown=node:node /app/node_modules/pdfmake/fonts ./node_modules/pdfmake/fonts
USER node
EXPOSE 3120
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3120/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

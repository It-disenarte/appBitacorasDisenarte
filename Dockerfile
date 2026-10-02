# Bitácora en Easypanel: Easypanel construye esta imagen desde el repo de GitHub.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/salud || exit 1

CMD ["node", "servidor.mjs"]

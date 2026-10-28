# Cash & Raus: Web-App (dist/public) und Server-Bundle (dist/server.mjs).
# Debian statt Alpine: better-sqlite3 bringt dafür fertige Binärdateien mit.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY build.mjs tsconfig.json ./
COPY shared shared
COPY src src
COPY public public
COPY server server
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    CR_PORT=8080 \
    CR_DATA_DIR=/data \
    CR_WEB_DIR=/app/dist/public
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "dist/server.mjs"]

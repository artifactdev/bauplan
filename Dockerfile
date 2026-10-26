# Self-hosted build with SQLite storage.
# docker build -t bauplan .
# docker run -p 3000:3000 -v /pfad/zu/daten:/data -v /pfad/zu/dokumenten:/uploads bauplan
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY . .
RUN bun run build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production \
    DATA_DIR=/data \
    UPLOADS_DIR=/uploads \
    PORT=3000
VOLUME ["/data", "/uploads"]
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

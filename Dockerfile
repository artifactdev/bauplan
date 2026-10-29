# Self-hosted build with SQLite storage.
# docker build -t bauplan .
# docker run -p 3000:3000 -v /pfad/zu/daten:/data -v /pfad/zu/dokumenten:/uploads bauplan
# The JS build runs natively on the build host: under QEMU emulation (multi-arch builds),
# Bun/Vite is very slow and can hang.
FROM --platform=$BUILDPLATFORM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY . .
RUN bun run build

FROM node:24-slim
ARG TARGETARCH
WORKDIR /app
COPY --from=build /app/.output ./.output
# @napi-rs/canvas (PDF rendering for OCR) is the only native module in the traced output;
# replace the build host's binary with the one for the target architecture.
RUN set -eu; \
    case "$TARGETARCH" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) echo "Unsupported arch $TARGETARCH" >&2; exit 1 ;; esac; \
    modules=/app/.output/server/node_modules/@napi-rs; \
    version=$(node -p "require('$modules/canvas/package.json').version"); \
    pkg="canvas-linux-$arch-gnu"; \
    if [ ! -d "$modules/$pkg" ]; then \
      cd /tmp; \
      npm pack --silent "@napi-rs/$pkg@$version"; \
      rm -rf "$modules"/canvas-linux-*; \
      mkdir -p "$modules/$pkg"; \
      tar -xzf "napi-rs-$pkg-$version.tgz" -C "$modules/$pkg" --strip-components=1; \
      rm -rf /tmp/*.tgz /root/.npm; \
    fi; \
    node -e "require('$modules/canvas')"
ENV NODE_ENV=production \
    DATA_DIR=/data \
    UPLOADS_DIR=/uploads \
    PORT=3000
VOLUME ["/data", "/uploads"]
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

# syntax=docker/dockerfile:1.7
# The image both container classes run. Context: the repository root (wrangler.jsonc image_build_context).
# The final stage holds only Node, the bundle and apfs-extract: disk is the tight resource.

ARG NODE_VERSION=22
ARG GO_VERSION=1.26

# apfs-extract reads APFS images without FUSE or mounts (containers allow neither). cgo for go-apfs's lzfse, linked static.
# Built natively and cross-compiled to amd64: Go under QEMU emulation panics on arm64 build machines.
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-bookworm AS apfs
RUN if [ "$(dpkg --print-architecture)" != amd64 ]; then \
      apt-get update && apt-get install -y --no-install-recommends gcc-x86-64-linux-gnu libc6-dev-amd64-cross && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /src
COPY apps/extractor/container/src/jobs/ios/ipsw/apfs-extract/go.mod apps/extractor/container/src/jobs/ios/ipsw/apfs-extract/go.sum ./
RUN go mod download
COPY apps/extractor/container/src/jobs/ios/ipsw/apfs-extract/ ./
RUN CC="$([ "$(dpkg --print-architecture)" = amd64 ] && echo gcc || echo x86_64-linux-gnu-gcc)" \
    CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w -linkmode external -extldflags=-static" -o /out/apfs-extract .

# Only the extractor and the workspace packages it depends on: the install is filtered to them, from the one lockfile.
FROM --platform=linux/amd64 node:${NODE_VERSION}-slim AS bundle
# Corepack takes pnpm's version from the root package.json.
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages packages
COPY apps/extractor apps/extractor
RUN pnpm install --frozen-lockfile --filter @carrier-explode/extractor... && pnpm --filter @carrier-explode/extractor build

FROM --platform=linux/amd64 node:${NODE_VERSION}-slim
ENV NODE_ENV=production
COPY --from=apfs /out/apfs-extract /usr/local/bin/apfs-extract
COPY --from=bundle /repo/apps/extractor/container/dist/ /app/
USER node
WORKDIR /app
EXPOSE 8080
CMD ["node", "--enable-source-maps", "/app/main.mjs"]

# syntax=docker/dockerfile:1.7
#
# The extractor's container image: HeavyExtractor and LightExtractor both run it.
# Build context is the repository root (wrangler.jsonc image_build_context), since
# the bundle includes the shared code in src/lib. Only three things reach the final
# image: Node, the bundle, and the apfs-extract helper ios.ipsw runs. Disk is the
# tight resource (20 GB on standard-4 holds the image, an IPSW and its unpacked
# filesystem image), so nothing else does.
#
# Cloudflare runs linux/amd64.

ARG NODE_VERSION=22
ARG GO_VERSION=1.26

# apfs-extract: reads APFS images with no FUSE or mount (containers allow neither).
# cgo, for go-apfs's lzfse; the binary needs glibc, which node:*-slim (Debian) has.
FROM --platform=linux/amd64 golang:${GO_VERSION}-bookworm AS apfs
WORKDIR /src
COPY extractor/container/src/jobs/ios/ipsw/apfs-extract/go.mod extractor/container/src/jobs/ios/ipsw/apfs-extract/go.sum ./
RUN go mod download
COPY extractor/container/src/jobs/ios/ipsw/apfs-extract/ ./
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/apfs-extract .

# The bundle. Dependencies are installed for the extractor alone; the site's are never pulled.
# After the monorepo move: `pnpm install --frozen-lockfile --filter @carrier-explode/extractor...`
# from the workspace root, and the paths below become apps/extractor and packages/*.
FROM --platform=linux/amd64 node:${NODE_VERSION}-slim AS bundle
WORKDIR /repo
RUN corepack enable
COPY extractor/package.json extractor/
RUN pnpm install --dir extractor
COPY package.json ./
COPY src/lib src/lib
COPY extractor/src extractor/src
COPY extractor/container extractor/container
RUN node extractor/container/build.mjs

FROM --platform=linux/amd64 node:${NODE_VERSION}-slim
ENV NODE_ENV=production
COPY --from=apfs /out/apfs-extract /usr/local/bin/apfs-extract
COPY --from=bundle /repo/extractor/container/dist/ /app/
USER node
WORKDIR /app
EXPOSE 8080
CMD ["node", "--enable-source-maps", "/app/main.mjs"]

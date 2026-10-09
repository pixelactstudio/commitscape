FROM rust:1-slim-bookworm AS binary
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml clippy.toml ./
COPY .cargo .cargo
COPY crates crates
COPY xtask xtask
RUN cargo build --profile dist -p commitscape

FROM node:24-bookworm-slim AS runner
WORKDIR /repo
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .oxlintrc.json turbo.json ./
COPY apps/builder/package.json apps/builder/
COPY packages/data/package.json packages/data/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --filter @commitscape/builder...
COPY packages/data packages/data
COPY packages/server packages/server
COPY apps/builder apps/builder
RUN pnpm --filter @commitscape/builder build

FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /work && chown node:node /work \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm
COPY --from=binary /src/target/dist/commitscape /usr/local/bin/commitscape
COPY --from=runner /repo/apps/builder/dist/builder.mjs ./builder.mjs
COPY packages/server/drizzle ./drizzle
ENV NODE_ENV=production MIGRATIONS_DIR=/app/drizzle WORK_DIR=/work COMMITSCAPE_BIN=commitscape
USER node
CMD ["node", "builder.mjs", "work"]

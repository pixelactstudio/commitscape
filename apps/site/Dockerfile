# syntax=docker/dockerfile:1
FROM node:26-bookworm-slim AS build
WORKDIR /repo
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .oxlintrc.json turbo.json ./
COPY apps/site/package.json apps/site/
COPY packages/data/package.json packages/data/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @commitscape/site...
COPY packages packages
COPY apps/site apps/site
ARG SENTRY_ORG
ARG SENTRY_PROJECT
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN \
  SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null)" pnpm --filter @commitscape/site build

FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build /repo/apps/site/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--import", "./.output/server/instrument.server.mjs", ".output/server/index.mjs"]

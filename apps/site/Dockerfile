# The marketing site (strictbudget.app): a static Astro build served by Caddy. Build it from the
# repo root, since it uses workspace packages:
#   docker build -f apps/site/Dockerfile -t strictbudget-site .
#   docker run -p 8080:8080 strictbudget-site

FROM node:24-slim AS build
WORKDIR /repo
# pnpm comes from package.json's packageManager field.
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @strictbudget/site...
RUN pnpm --filter @strictbudget/site build

FROM caddy:2-alpine
COPY apps/site/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/site/dist /srv
ENV PORT=8080
EXPOSE 8080

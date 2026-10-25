# strictbudget: one image runs the API, serves the web app, and runs the migrate step.
#   docker build -t strictbudget .
#   docker run --rm -e DATABASE_URL=… strictbudget node dist/migrate.mjs   # before each new version
#   docker run -p 3000:3000 -e DATABASE_URL=… -e BETTER_AUTH_SECRET=… … strictbudget
# Nothing in it is specific to one host (Railway, Docker Compose, Coolify, …).

FROM node:24-slim AS build
WORKDIR /repo
# pnpm comes from package.json's packageManager field.
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@strictbudget/api --filter=@strictbudget/web
# The API's production dependencies on their own (workspace packages are bundled into dist/).
RUN pnpm --filter @strictbudget/api deploy --prod --legacy /out

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
# dist/migrate.mjs reads them from ../migrations.
COPY --from=build /repo/packages/db/migrations ./migrations
COPY --from=build /repo/apps/web/dist ./web
# Attachments on disk when there's no S3 bucket (STORAGE_DIR=/data); a volume mounted here keeps
# the node user as its owner.
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.mjs"]

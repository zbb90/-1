FROM docker.m.daocloud.io/library/node:20-alpine AS base

FROM base AS builder
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY apps/admin apps/admin
COPY packages/shared packages/shared
COPY scripts scripts
COPY data data

RUN npm run build --workspace @audit-ai/admin

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3003
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/apps/admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/data ./data

USER nextjs
EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3003/api/health || exit 1

CMD ["node", "apps/admin/server.js"]

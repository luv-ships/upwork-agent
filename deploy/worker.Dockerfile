# Persistent worker image. Build from the repository root.
FROM node:22-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @upwork-agent/core build \
  && pnpm --filter @upwork-agent/db build \
  && pnpm --filter @upwork-agent/worker build

ENV NODE_ENV=production
ENV WORKER_HEALTH_PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node --input-type=module -e "const response = await fetch('http://127.0.0.1:8080/health'); if (!response.ok) process.exit(1)"
CMD ["node", "apps/worker/dist/main.js"]

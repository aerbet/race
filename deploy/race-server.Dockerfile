# Сервер гонок (Node + ws + Rapier). Контекст — корень репозитория (pnpm workspace).
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/physics packages/physics
COPY apps/race-server apps/race-server
RUN pnpm install --frozen-lockfile --prod=false --filter race-server...
ENV NODE_ENV=production PORT=2567
USER node
EXPOSE 2567
WORKDIR /app/apps/race-server
CMD ["node", "--import", "tsx", "src/index.ts"]

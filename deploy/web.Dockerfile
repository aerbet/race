# Клиент: сборка Vite → статика в nginx. API и сервер гонок — за тем же доменом
# (nginx проксирует /api, /webhooks и /ws), поэтому адреса в сборке — same-origin.
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter client...
ARG VITE_YT_API_KEY=
ENV VITE_API_URL=same-origin VITE_SERVER_URL=same-origin VITE_YT_API_KEY=$VITE_YT_API_KEY
RUN pnpm --filter client build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/client/dist /usr/share/nginx/html
EXPOSE 80

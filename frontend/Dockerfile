# syntax=docker/dockerfile:1

# the Angular build always runs on the build host architecture; only the
# nginx runtime stage is built per target platform.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.29-alpine AS runtime
LABEL org.opencontainers.image.source=https://github.com/jfhack/cadence
LABEL org.opencontainers.image.description="Cadence frontend: Angular UI served by nginx, proxying the API and websockets to the backend"
LABEL org.opencontainers.image.licenses=MIT

# FRONTEND_PATH and API_PATH are independent; "/" keeps the classic layout.
ENV BACKEND_HOST=cadence-backend \
    BACKEND_PORT=8000 \
    NGINX_RESOLVER=127.0.0.11 \
    FRONTEND_PATH=/ \
    API_PATH=/ \
    API_RATE_LIMIT=10 \
    API_RATE_BURST=20

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
# sourced before the template is rendered, so it can export derived values.
COPY nginx/10-cadence-paths.envsh /docker-entrypoint.d/10-cadence-paths.envsh
RUN chmod +x /docker-entrypoint.d/10-cadence-paths.envsh
COPY --from=build /app/dist/cadence/browser /usr/share/nginx/html
# body for the blank 404 above; kept outside the web root so it is only ever
# reachable through the internal error_page redirect.
RUN mkdir -p /usr/share/nginx/nothing && : > /usr/share/nginx/nothing/empty

EXPOSE 80

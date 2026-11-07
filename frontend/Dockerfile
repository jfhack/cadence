# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.31.8-alpine@sha256:713fc2ebfd92e8217db451477182ee91944b123d2b1ee9fd5a8c6e91ca6c3a11 AS runtime
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

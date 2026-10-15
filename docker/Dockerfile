# syntax=docker/dockerfile:1

# Build stage: the Node version matches .nvmrc.
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Runtime stage: static files only, served by nginx as an unprivileged user on port 8080.
FROM nginxinc/nginx-unprivileged:1.29.8-alpine
# Set by release.yml; `docker inspect` tells which release runs (docs/f12-release-plan.md).
ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.source="https://github.com/AstRonin/radio-atlantida-frontend" \
      org.opencontainers.image.title="radio-atlantida-frontend" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"
# Grafana's address for the panel's link (empty: monitoring off), written into /config.json at
# container start by the image's envsubst step; nothing else in the template is substituted.
ENV GRAFANA_URL="" \
    NGINX_ENVSUBST_FILTER="^GRAFANA_URL$"
COPY --chmod=644 docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/radio-atlantida-frontend/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

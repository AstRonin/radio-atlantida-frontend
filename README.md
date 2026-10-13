# radio-atlantida-frontend

Angular management panel for the Radio Atlantida automation system. The backend, deployment, and
design documents live in the sibling repositories and in `docs/`.

## Requirements

- Node.js 24 LTS (see `.nvmrc`) and npm
- Docker (for the container image)
- The backend running on `http://127.0.0.1:8080` for live data in development

## Development

```sh
npm ci
npm run dev          # http://localhost:4200, /api is proxied to 127.0.0.1:8080
npm run lint
npm run format:check
npm test
npm run build
```

## Container

```sh
docker build -f docker/Dockerfile -t radio-atlantida-frontend .
docker run --rm -p 8080:8080 radio-atlantida-frontend
```

The image serves the panel on port 8080 and proxies `/api` (including the `/api/ws` WebSocket) to the
`backend` service on the Docker Compose network.

## Languages

UI texts live in `src/assets/i18n/<lang>.json`. To add a language, copy `en.json` to `<code>.json`,
translate the values, and add `{ "code": "<code>", "name": "<Name>" }` to `languages.json`. No code
change is needed.

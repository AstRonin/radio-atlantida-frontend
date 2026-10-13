#!/usr/bin/env node
// Copies the backend OpenAPI specification into api/openapi.json (docs/frontend-init-plan.md 9.2).
// The snapshot is committed, so builds never need the backend; run `npm run api:generate` afterwards.
//
// Usage: npm run api:sync [-- <path-to-openapi.json>]
// Default source: the sibling backend checkout, after `make openapi` has been run there.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(
  process.argv[2] ?? resolve(root, '../radio-atlantida-backend/api/openapi.json'),
);
const target = resolve(root, 'api/openapi.json');

let text;
try {
  text = await readFile(source, 'utf8');
} catch (error) {
  fail(
    `Cannot read ${source} (${error.code ?? error.message}).\n` +
      'Run `make openapi` in the backend, or pass the file: npm run api:sync -- <path>',
  );
}

let spec;
try {
  spec = JSON.parse(text);
} catch (error) {
  fail(`${source} is not valid JSON: ${error.message}`);
}
if (typeof spec.openapi !== 'string' || typeof spec.paths !== 'object' || spec.paths === null) {
  fail(`${source} is not an OpenAPI document (no "openapi" version or "paths").`);
}

// The repository is LF only (.gitattributes); a spec generated on Windows must not bring CRLF in.
const normalized = text.replace(/\r\n/g, '\n');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, normalized.endsWith('\n') ? normalized : `${normalized}\n`);

const version = spec.info?.version ?? 'unknown';
console.log(
  `Copied ${source} -> ${relative(root, target)} ` +
    `(OpenAPI ${spec.openapi}, API version ${version}, ${Object.keys(spec.paths).length} paths).`,
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

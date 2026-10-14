import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createApp } from './bootstrap.js';
import { buildOpenApiDocument } from './openapi/openapi.js';

/** Exporta o documento OpenAPI para docs/openapi.json (executado no CI e antes de releases). */
const app = await createApp({ logger: false });
await app.init();
const document = buildOpenApiDocument(app);
const target = resolve(process.argv[2] ?? '../../docs/openapi.json');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
await app.close();
console.info(`OpenAPI exportado em ${target}`);

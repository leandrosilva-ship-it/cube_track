#!/usr/bin/env node
// Gera `src/generated/schema.ts` a partir de `docs/openapi.json` (raiz do monorepo).
//
// Pré-processamento necessário: o exportador OpenAPI da API (zod → JSON Schema, para os poucos
// schemas recursivos do produto — condições de filtro de views/saved-filters e `showWhen` de campos
// de formulário condicionais) emite, em cada ocorrência, um `$defs` LOCAL aninhado dentro do próprio
// schema (ex.: `paths./v1/views/{id}.get.responses.200...schema.$defs.__schema0`) com um
// `$ref: "#/$defs/__schema0"` que é um JSON Pointer absoluto (resolvido a partir da RAIZ do
// documento, não do escopo local aninhado — não há `$id` criando um novo escopo de resolução).
// openapi-typescript/Redocly resolvem $ref dessa forma (conforme a especificação JSON Schema), então
// cada uma dessas 16 ocorrências falha ao resolver. As 16 ocorrências são byte-a-byte idênticas
// (mesmo tipo recursivo reaproveitado), então a correção é só hoistear esse `$defs` UMA vez para a
// raiz do documento — sem tocar em `apps/api` nem no `docs/openapi.json` versionado, só na cópia em
// memória usada para gerar os tipos deste pacote.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const openapiPath = resolve(root, '../../docs/openapi.json');
const outputPath = resolve(root, 'src/generated/schema.ts');

function hashOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Encontra todo `$defs` aninhado (fora da raiz) e devolve `{ pointerPath, defs }` para cada um. */
function collectNestedDefs(node, atRoot, acc) {
  if (node === null || typeof node !== 'object') return;
  if (!atRoot && !Array.isArray(node) && '$defs' in node) {
    acc.push(node.$defs);
  }
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    collectNestedDefs(value, false, acc);
  }
}

async function main() {
  const raw = await readFile(openapiPath, 'utf8');
  const document = JSON.parse(raw);

  const nestedDefsGroups = [];
  collectNestedDefs(document, true, nestedDefsGroups);

  if (nestedDefsGroups.length > 0) {
    const hoisted = document.$defs ?? {};
    for (const defs of nestedDefsGroups) {
      for (const [key, schema] of Object.entries(defs)) {
        const existing = hoisted[key];
        if (existing === undefined) {
          hoisted[key] = schema;
        } else if (hashOf(existing) !== hashOf(schema)) {
          throw new Error(
            `generate.mjs: $defs/${key} aninhado em docs/openapi.json não é idêntico em todas as ` +
              'ocorrências — hoist automático para a raiz do documento não é seguro. Revise o ' +
              'exportador OpenAPI (schemas recursivos) antes de gerar o SDK.',
          );
        }
      }
    }
    document.$defs = hoisted;
    console.info(
      `generate.mjs: hoisted ${String(Object.keys(hoisted).length)} $defs aninhado(s) para a raiz ` +
        'do documento OpenAPI (correção local, não persistida em docs/openapi.json).',
    );
  }

  const ast = await openapiTS(document, { silent: true });
  const contents = astToString(ast);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    '// Arquivo gerado — não editar à mão. Rode `pnpm --filter @cube-track/sdk generate` para ' +
      'atualizar a partir de `docs/openapi.json`.\n' +
      '/* eslint-disable */\n' +
      contents,
  );
  console.info(`generate.mjs: escrito ${outputPath}`);
}

await main();

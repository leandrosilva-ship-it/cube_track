import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { z, type ZodType } from 'zod';

import { AUDITED_METADATA, type AuditedSpec } from '../core/audit/audited.js';
import { ENDPOINT_METADATA, type EndpointSpec } from '../core/http/endpoint.js';
import { ProblemSchema } from '../core/http/schemas.js';

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'all', 'options', 'head'] as const;
const PREFIX_EXCLUDED = new Set(['/health/live', '/health/ready']);

export interface RouteDescriptor {
  method: string;
  path: string;
  controller: string;
  handler: string;
  endpoint: EndpointSpec | undefined;
  audited: AuditedSpec | undefined;
  readOnly: boolean;
}

function joinPath(...parts: string[]): string {
  const joined = `/${parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')
    .join('/')}`;
  return joined === '' ? '/' : joined;
}

/** Enumera as rotas REST registradas (usado pelo OpenAPI e pelo teste de auditoria obrigatória). */
export function listRoutes(app: INestApplication): RouteDescriptor[] {
  const routes: RouteDescriptor[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (controller === null) continue;
      const base = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const methodIndex = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        const routePath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (methodIndex === undefined || routePath === undefined) continue;
        const local = joinPath(base, routePath);
        routes.push({
          method: METHODS[methodIndex] ?? 'get',
          path: PREFIX_EXCLUDED.has(local) ? local : joinPath('v1', local),
          controller: controller.name,
          handler: name,
          endpoint: Reflect.getMetadata(ENDPOINT_METADATA, handler) as EndpointSpec | undefined,
          audited: Reflect.getMetadata(AUDITED_METADATA, handler) as AuditedSpec | undefined,
          readOnly: Reflect.getMetadata('cube:read-only', handler) === true,
        });
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function jsonSchema(schema: ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const result = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
    target: 'draft-2020-12',
  }) as Record<string, unknown>;
  delete result.$schema;
  return result;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Criado',
  202: 'Aceito',
  204: 'Sem conteúdo',
  302: 'Redirecionamento',
  400: 'Dados inválidos',
  401: 'Não autenticado',
  403: 'Acesso negado',
  404: 'Não encontrado',
  409: 'Conflito',
  413: 'Conteúdo muito grande',
  422: 'Não processável',
  423: 'Conta bloqueada',
  429: 'Limite de requisições',
  500: 'Erro interno',
  503: 'Indisponível',
};

/** Gera o documento OpenAPI 3.1 a partir dos metadados `@Endpoint` (schemas Zod). */
export function buildOpenApiDocument(app: INestApplication): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const problem = { $ref: '#/components/schemas/Problem' };
  for (const route of listRoutes(app)) {
    const spec = route.endpoint;
    if (spec === undefined) continue;
    const openApiPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const parameters: Record<string, unknown>[] = [];
    for (const [location, schema] of [
      ['path', spec.params],
      ['query', spec.query],
    ] as const) {
      if (schema === undefined) continue;
      const json = jsonSchema(schema, 'input') as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, property] of Object.entries(json.properties ?? {})) {
        parameters.push({
          name,
          in: location,
          required: location === 'path' || (json.required ?? []).includes(name),
          schema: property,
        });
      }
    }
    if (route.method === 'post') {
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description: 'Chave de idempotência (24 h). Repetições retornam a mesma resposta.',
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' },
      });
    }
    const success = spec.status ?? (route.method === 'post' ? 201 : 200);
    const responses: Record<string, unknown> = {
      [success]: {
        description: STATUS_TEXT[success] ?? 'OK',
        ...(spec.response === undefined || success === 204
          ? {}
          : { content: { 'application/json': { schema: jsonSchema(spec.response, 'output') } } }),
      },
    };
    const errorStatuses = new Set([
      400,
      ...(spec.public === true ? [] : [401, 403]),
      404,
      429,
      500,
      ...(spec.errors ?? []),
    ]);
    for (const status of errorStatuses) {
      responses[status] =
        status === 302
          ? { description: STATUS_TEXT[302] }
          : {
              description: STATUS_TEXT[status] ?? 'Erro',
              content: { 'application/problem+json': { schema: problem } },
            };
    }
    paths[openApiPath] ??= {};
    paths[openApiPath][route.method] = {
      operationId: `${route.controller.replace(/Controller$/, '')}_${route.handler}`,
      summary: spec.summary,
      ...(spec.description === undefined ? {} : { description: spec.description }),
      tags: spec.tags,
      ...(spec.public === true ? { security: [] } : {}),
      ...(parameters.length === 0 ? {} : { parameters }),
      ...(spec.body === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: jsonSchema(spec.body, 'input') } },
            },
          }),
      responses,
      ...(route.audited === undefined ? {} : { 'x-audit-action': route.audited.action }),
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'CUBE TRACK API',
      version: '1.0.0',
      description:
        'API REST v1 do CUBE TRACK. Erros seguem RFC 7807 (`application/problem+json`). Paginação por cursor (`limit`, `cursor`). ' +
        'Multi-tenant: o tenant é resolvido pelo subdomínio ou pelo header `X-Tenant` e deve coincidir com o do token. ' +
        'Leituras agregadas também estão disponíveis em GraphQL (`/v1/graphql`, somente leitura).',
    },
    servers: [{ url: '/' }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { Problem: jsonSchema(ProblemSchema, 'output') },
      parameters: {},
    },
    paths,
  };
}

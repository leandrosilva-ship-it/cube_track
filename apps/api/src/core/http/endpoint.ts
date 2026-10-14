import {
  applyDecorators,
  createParamDecorator,
  HttpCode,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ZodType } from 'zod';

import { ValidationError } from '../errors/problems.js';

/**
 * Metadados de um endpoint REST: fonte única para validação (Zod) e para o documento OpenAPI.
 */
export interface EndpointSpec {
  summary: string;
  description?: string;
  tags: string[];
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  response?: ZodType;
  /** Status de sucesso (padrão 200; POST de criação usa 201). */
  status?: number;
  /** Rota sem autenticação. */
  public?: boolean;
  /** Respostas de erro relevantes além das genéricas (400/401/403/404/429/500). */
  errors?: number[];
}

export const ENDPOINT_METADATA = 'cube:endpoint';

export function Endpoint(spec: EndpointSpec): MethodDecorator {
  const decorators: MethodDecorator[] = [SetMetadata(ENDPOINT_METADATA, spec)];
  if (spec.status !== undefined) decorators.push(HttpCode(spec.status));
  if (spec.public === true) decorators.push(SetMetadata(PUBLIC_METADATA, true));
  return applyDecorators(...decorators);
}

export const PUBLIC_METADATA = 'cube:public';

type InputSource = 'params' | 'query' | 'body';

/** Injeta e valida `params`, `query` ou `body` com o schema declarado em `@Endpoint`. */
export const Input = createParamDecorator((source: InputSource, context: ExecutionContext) => {
  const spec = Reflect.getMetadata(ENDPOINT_METADATA, context.getHandler()) as
    | EndpointSpec
    | undefined;
  const schema = spec?.[source];
  const request = context.switchToHttp().getRequest<Request>();
  const raw: unknown =
    source === 'body' ? request.body : source === 'query' ? request.query : request.params;
  if (schema === undefined) return raw;
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => ({
        path: [source, ...issue.path.map(String)].join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }
  return parsed.data;
});

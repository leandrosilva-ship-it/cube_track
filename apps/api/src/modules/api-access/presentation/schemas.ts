import { API_SCOPES } from '@cube-track/shared/api-access';
import { z } from 'zod';

export const ApiScopeSchema = z.enum(API_SCOPES);

export const ApiTokenSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  userName: z.string().nullable(),
  oauthAppId: z.uuid().nullable(),
  name: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(ApiScopeSchema),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

/** Só na criação: o token em texto simples (nunca mais é devolvido). */
export const ApiTokenWithSecretSchema = ApiTokenSchema.extend({ token: z.string() });

export const CreateApiTokenBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    scopes: z.array(ApiScopeSchema).min(1).max(API_SCOPES.length),
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export const OAuthAppSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  clientId: z.string(),
  scopes: z.array(ApiScopeSchema),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const OAuthAppWithSecretSchema = OAuthAppSchema.extend({ clientSecret: z.string() });

export const CreateOAuthAppBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    scopes: z.array(ApiScopeSchema).min(1).max(API_SCOPES.length),
  })
  .strict();

export const UpdateOAuthAppBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    scopes: z.array(ApiScopeSchema).min(1).max(API_SCOPES.length).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const OAuthTokenBody = z
  .object({
    grant_type: z.literal('client_credentials'),
    client_id: z.string().trim().min(1).max(200),
    client_secret: z.string().trim().min(1).max(500),
  })
  .strict();

export const OAuthTokenResponse = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
});

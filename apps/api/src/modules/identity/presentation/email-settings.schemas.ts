import { z } from 'zod';

export const EmailSettingsResponse = z.object({
  enabled: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  secure: z.boolean(),
  username: z.string().nullable(),
  hasPassword: z.boolean(),
  fromAddress: z.string().nullable(),
  updatedAt: z.iso.datetime().nullable(),
});

export const UpdateEmailSettingsBody = z
  .object({
    enabled: z.boolean().optional(),
    host: z.string().min(1).max(255).optional(),
    port: z.int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    username: z.string().max(255).nullable().optional(),
    /** Texto puro — cifrada antes de salvar; nunca devolvida (ver `hasPassword`). Omitido mantém a
     * senha atual; `null` limpa. */
    password: z.string().min(1).max(512).nullable().optional(),
    fromAddress: z.string().max(255).nullable().optional(),
  })
  .strict();

export const SendTestEmailBody = z.object({}).strict();

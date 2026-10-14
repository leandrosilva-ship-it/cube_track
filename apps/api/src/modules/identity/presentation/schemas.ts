import { z } from 'zod';

export const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const password = z.string().min(1).max(128);

export const SessionResponse = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  sessionId: z.uuid(),
  refreshToken: z.string().optional(),
  user: z.object({ id: z.uuid(), email: z.string(), name: z.string(), mfaEnabled: z.boolean() }),
  tenant: z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    kind: z.enum(['member', 'guest']),
    roleKey: z.string(),
  }),
});

export const MfaChallengeResponse = z.object({
  mfaRequired: z.literal(true),
  challengeToken: z.string(),
  expiresIn: z.number().int(),
});
export const LoginResponse = z.union([SessionResponse, MfaChallengeResponse]);

export const SignupBody = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  password,
  organizationName: z.string().trim().min(2).max(120),
  organizationSlug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Use letras minúsculas, números e hífens.'),
});
export const LoginBody = z.object({ email, password });
export const EmailBody = z.object({ email });
export const TokenBody = z.object({ token: z.string().min(16).max(256) });
export const ResetPasswordBody = z.object({ token: z.string().min(16).max(256), password });
export const MfaVerifyBody = z
  .object({
    challengeToken: z.string().min(16),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z.string().max(20).optional(),
  })
  .refine(
    (body) => body.code !== undefined || body.recoveryCode !== undefined,
    'Informe o código ou um código de recuperação.',
  );
export const RefreshBody = z.object({ refreshToken: z.string().max(256).optional() }).default({});
export const SwitchBody = z.object({ tenantId: z.uuid() });
export const ProviderParams = z.object({ provider: z.enum(['google', 'microsoft']) });
export const OAuthStartQuery = z.object({ loginHint: z.email().optional() });
export const OAuthCallbackQuery = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(256),
  error: z.string().max(200).optional(),
});
export const Accepted = z.object({ status: z.literal('accepted') });
export const Organizations = z.object({
  data: z.array(
    z.object({
      tenantId: z.uuid(),
      tenantName: z.string(),
      tenantSlug: z.string(),
      kind: z.enum(['member', 'guest']),
      roleKey: z.string(),
    }),
  ),
});

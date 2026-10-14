import { api } from '@/lib/api/client';
import type {
  InvitationPreview,
  LoginResponse,
  Organization,
  SessionResponse,
} from '@/lib/api/types';

/** Chamadas públicas de autenticação (refresh token volta em cookie HttpOnly). */
export const authApi = {
  login: (email: string, password: string) =>
    api<LoginResponse>('/v1/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password },
    }),
  signup: (input: {
    name: string;
    email: string;
    password: string;
    organizationName: string;
    organizationSlug: string;
  }) => api<SessionResponse>('/v1/auth/signup', { method: 'POST', auth: false, body: input }),
  verifyMfa: (challengeToken: string, input: { code?: string; recoveryCode?: string }) =>
    api<SessionResponse>('/v1/auth/mfa/verify', {
      method: 'POST',
      auth: false,
      body: { challengeToken, ...input },
    }),
  requestMagicLink: (email: string) =>
    api<{ status: 'accepted' }>('/v1/auth/magic-link', {
      method: 'POST',
      auth: false,
      body: { email },
    }),
  verifyMagicLink: (token: string) =>
    api<LoginResponse>('/v1/auth/magic-link/verify', {
      method: 'POST',
      auth: false,
      body: { token },
    }),
  forgotPassword: (email: string) =>
    api<{ status: 'accepted' }>('/v1/auth/password/forgot', {
      method: 'POST',
      auth: false,
      body: { email },
    }),
  resetPassword: (token: string, password: string) =>
    api<undefined>('/v1/auth/password/reset', {
      method: 'POST',
      auth: false,
      body: { token, password },
    }),
  verifyEmail: (token: string) =>
    api<undefined>('/v1/auth/email/verify', { method: 'POST', auth: false, body: { token } }),
  invitation: (token: string) =>
    api<InvitationPreview>(`/v1/invitations/preview/${encodeURIComponent(token)}`, { auth: false }),
  acceptInvitation: (input: { token: string; name?: string; password?: string }) =>
    api<SessionResponse>('/v1/invitations/accept', { method: 'POST', auth: false, body: input }),
  organizations: () => api<{ data: Organization[] }>('/v1/auth/organizations'),
  switchOrganization: (tenantId: string) =>
    api<SessionResponse>('/v1/auth/switch-organization', { method: 'POST', body: { tenantId } }),
};

export function isMfaChallenge(
  response: LoginResponse,
): response is Extract<LoginResponse, { mfaRequired: true }> {
  return 'mfaRequired' in response;
}

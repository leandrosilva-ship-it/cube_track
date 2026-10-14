# ADR 0026 — Autenticação nativa na API; SAML/SCIM por portas

- **Status:** Aceita (substitui parcialmente a ADR 0010)
- **Data:** 2026-10-14
- **Prompt:** 3

## Contexto

O Prompt 3 pede e-mail/senha, magic link, OAuth Google/Microsoft, refresh token rotativo, MFA TOTP, recuperação de senha e convites por e-mail. Pede também uma interface pronta para SAML e SCIM, a ser implementada no Prompt 16. A ADR 0010 previa o Keycloak como broker. Isso exigiria operar mais um serviço com estado e sincronizar usuários e sessões entre dois sistemas, sem ganho funcional nesta fase.

## Decisão

- A identidade é implementada **na própria API** (módulo `identity`):
  - Senhas com **Argon2id** (19 MiB, t=2, OWASP).
  - Bloqueio progressivo após falhas, com mensagens que não revelam se a conta existe.
  - Magic link e recuperação com tokens de uso único, guardados apenas como hash SHA-256 (`auth_tokens`).
- **Sessões e tokens:**
  - **Access token** JWT HS256 de 10 min, com `typ at+jwt` e claims `sub`, `tid`, `sid`, `knd`, `amr`.
  - **Refresh token** opaco em cookie `HttpOnly; SameSite=Lax; Path=/v1/auth` (Lax para permitir o retorno do OAuth).
  - Rotação a cada uso, com **família**: reusar um token já rotacionado revoga a família inteira e gera auditoria de segurança.
- **OAuth/OIDC** (Google e Microsoft): authorization code + **PKCE**, `state` e `nonce`, verificação do `id_token` via JWKS (`jose`). O vínculo é feito por `user_identities` e e-mails não verificados pelo provedor são recusados.
- **MFA TOTP** (RFC 6238):
  - O segredo é cifrado com AES-256-GCM (`ENCRYPTION_KEY`).
  - Há 10 códigos de recuperação de uso único (hash).
  - Proteção contra replay do mesmo passo.
  - Quando o MFA está ativo, o login gera um desafio curto (`mfa_token`) antes da sessão.
- **Troca de organização:** `POST /v1/auth/switch-organization` emite uma sessão nova no tenant de destino, desde que o usuário seja membro ativo dele.
- **SAML e SCIM:** as portas `SamlIdentityProvider` e `ScimProvisioningPort` ficam em `identity/application/ports.ts`. Nenhuma rota é exposta sem adaptador registrado. O Keycloak (ou outro IdP) pode entrar depois como adaptador SAML, sem mudar o modelo de sessões.

## Alternativas consideradas

- **Keycloak como broker desde já:** mais um serviço com estado, tema e i18n próprios, e sessões duplicadas. Fica como opção de adaptador para SAML no Prompt 16.
- **Bibliotecas prontas (Passport, Auth.js):** pouca aderência a multi-tenant, rotação por família e RLS.

## Consequências

- As regras de segurança ficam testáveis no próprio repositório (`apps/api/test/auth.e2e.test.ts`).
- Precisamos manter cuidado com chaves: `JWT_SECRET` e `ENCRYPTION_KEY` vêm de secret manager em produção. A rotação de chaves fica para o Prompt 16.
- As tabelas de identidade usam o papel `app_auth` (ADR 0028).

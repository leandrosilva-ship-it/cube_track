# ADR 0010 — Identidade: OIDC com Keycloak como broker; SCIM 2.0 na API

- **Status:** Aceita (revisar após resposta à dúvida D1/D6)
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto

Requisitos: login com e-mail/senha, Google, Microsoft Entra ID, SAML corporativo/governamental, MFA, provisionamento via SCIM, sessão segura, multi-tenant (usuário em várias organizações), dados no Brasil.

## Decisão

- **Keycloak** (autogerido, um realm de plataforma com _Identity Providers_ por tenant) como **broker OIDC/SAML**, responsável por senha, MFA (TOTP/WebAuthn), federação Google/Entra/SAML e políticas de senha.
- A aplicação é **cliente OIDC** (Authorization Code + PKCE). A API emite seu **próprio access token curto** (JWT, 10 min, com `tid`, `sub`, `sid`, papéis resumidos) e refresh token rotativo em cookie `HttpOnly; Secure; SameSite=Lax` — desacoplando autorização do IdP.
- **SSO por tenant**: domínio de e-mail verificado → IdP do tenant; opção "SSO obrigatório".
- **SCIM 2.0** implementado no módulo `identity` da API (Users/Groups), pois o suporte nativo do Keycloak depende de plugins.
- API keys / OAuth client credentials para a API pública (Prompt 15).

## Alternativas consideradas

- **Auth0/Okta/WorkOS**: menor operação, porém custo por MAU/conexão SSO e residência de dados fora do Brasil.
- **Zitadel**: moderno, multi-tenant nativo; ecossistema menor no Brasil. Reavaliar se Keycloak se mostrar pesado.
- **Auth própria (Auth.js/better-auth)**: SAML e MFA robustos exigiriam muito código sensível.

## Consequências

- Keycloak entra no docker-compose e no Helm; backup e upgrade são responsabilidade nossa.
- Logout e revogação propagam para o realtime (room `u:{userId}`, evento `session.revoked`).

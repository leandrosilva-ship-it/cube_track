# ADR 0032 — Autenticação no frontend: mesma origem, access token em memória e refresh serializado

- **Status:** Aceita (complementa a ADR 0026)
- **Data:** 2026-10-14
- **Prompt:** 4

## Contexto

A API emite um access JWT de 10 min e um refresh token rotativo com detecção de reuso por família (ADR 0026). O navegador precisa:

- manter a sessão entre recarregamentos sem expor tokens a XSS;
- funcionar com várias abas abertas;
- tolerar redes móveis instáveis.

## Decisão

- **Mesma origem:**
  - O Next reescreve `/v1/:path*` para `API_INTERNAL_URL`.
  - O cookie de refresh `ct_refresh` (HttpOnly, `SameSite=Lax`, `path=/v1/auth`) fica first-party e só viaja para as rotas de autenticação.
- **Access token só em memória** (store Zustand vanilla), nunca em `localStorage`.
  - Ao abrir a aplicação, `bootstrapSession()` chama `POST /v1/auth/refresh`.
  - A renovação é proativa, 60 s antes de expirar.
  - Um 401 em qualquer chamada faz um refresh e uma única nova tentativa.
- **Refresh single-flight e serializado entre abas** com Web Locks (`ct-auth-refresh`), porque dois refreshes paralelos com o mesmo token disparariam a detecção de reuso. A coordenação entre abas usa `BroadcastChannel('ct-auth')`:
  - `signed-out` encerra as outras abas;
  - `session-changed` (login ou troca de organização) as renova.
- **Tolerância de reapresentação no servidor** (`REFRESH_REUSE_GRACE_SECONDS`, padrão 30 s):
  - Cobre o caso em que a resposta de uma rotação se perde (aba fechada no meio do refresh, rede móvel caindo).
  - Se o token rotacionado volta dentro da janela **e o sucessor nunca foi usado**, a API reemite a sessão e revoga o sucessor como `superseded` (auditoria `auth.refresh_reissued`).
  - Se o sucessor já circulou, continua sendo reuso, e a família inteira é revogada.
  - Valor `0` desativa a tolerância.
- **Shell autenticado:**
  - Renderiza logo após montar, em paralelo à recuperação da sessão.
  - As queries só disparam com `status === 'authenticated'` (`useAuthenticated()`).
  - Sessão anônima redireciona para `/login?next=…`; `safeNextPath` aceita apenas caminhos internos.

## Alternativas consideradas

- **Access token em cookie lido por um BFF/Server Components:** permitiria SSR com dados (melhor LCP no mobile), mas exige proteção CSRF em toda a API e um BFF com estado. Reavaliar no Prompt 16 (ver ADR 0036).
- **Refresh token em `localStorage`:** exposto a XSS.
- **Detecção de reuso sem tolerância:** desloga usuários legítimos em redes instáveis. O próprio Lighthouse reproduziu o problema ao fechar abas durante um refresh.

## Consequências

- Primeira renderização das telas autenticadas depende de um round-trip de refresh.
- Um token roubado nos 30 s seguintes a uma rotação cuja resposta se perdeu poderia ser usado uma vez. O sucessor legítimo então é revogado, o que expõe o incidente na próxima renovação. É o mesmo compromisso de Auth0 ("reuse interval") e Okta ("grace period").

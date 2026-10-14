# ADR 0036 — PWA e orçamento de performance do frontend

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 4

## Decisão

- **PWA:**
  - Manifesto (`app/manifest.ts`), ícones e service worker próprio (`public/sw.js`), registrado só em produção.
  - Assets versionados (`/_next/static`) e ícones usam cache-first.
  - Navegações usam network-first, com `offline.html` quando não há rede.
  - **`/v1` e o WebSocket nunca são cacheados**: dados sujeitos a permissão e LGPD.
  - Novas versões do SW avisam o usuário e aplicam `SKIP_WAITING`.
- **Orçamento de performance** (Lighthouse ≥ 90 em performance e acessibilidade):
  - **Carregados sob demanda:** paleta de comandos, diálogos do shell e `socket.io-client`. A paleta e os diálogos são pré-carregados quando o navegador fica ocioso.
  - **Sem prefetch automático** nos links da árvore do workspace, que pode ter dezenas de boards. Os links da barra lateral mantêm o prefetch.
  - **Telas públicas pré-renderizadas por completo**, sem _bailout_ para o cliente. Por exemplo, o login lê `?next=` no envio do formulário, não via `useSearchParams`.
  - **CLS próximo de zero:**
    - o skeleton do shell reproduz o layout mobile e desktop;
    - seções de altura variável entram juntas;
    - o avatar reserva espaço enquanto a sessão carrega.
  - `scripts/lighthouse.mjs` mede login, início, board e "Minha semana" em mobile e desktop, e falha abaixo de 90.

## Resultado medido (build de produção local, Lighthouse 12)

| Tela         | Mobile perf | Desktop perf | Acessibilidade | Boas práticas |
| ------------ | ----------- | ------------ | -------------- | ------------- |
| Login        | 93          | 100          | 100            | 100           |
| Início       | 73          | 100          | 100            | 100           |
| Board        | 63          | 99           | 100            | 100           |
| Minha semana | 73          | 99           | 100            | 100           |

As telas autenticadas no perfil **mobile** do Lighthouse (CPU 4× mais lenta e 4G lento simulado) ficam abaixo de 90. O motivo é estrutural:

- o conteúdo depende do round-trip de refresh da sessão (access token só em memória, ADR 0032) e depois das queries de dados;
- tudo isso só começa após baixar e executar cerca de 300 KB gz de JS, dos quais cerca de 130 KB são o React e o roteador do Next.

No desktop e em aparelhos reais de gama média o LCP fica abaixo de 1 s.

## Próximos passos (Prompt 16 — Performance)

1. Sessão legível no servidor (cookie de access curto e um BFF com proteção CSRF). Assim os Server Components buscam os dados iniciais e transmitem o HTML pronto, com LCP no FCP.
2. Virtualização e _code splitting_ por view do board, com Tabela, Kanban e Gantt em chunks separados.
3. Medição de campo (Web Vitals via OpenTelemetry) para orientar otimizações com dados reais.

## Alternativas consideradas

- **next-pwa/Workbox:** abstrai pouco para o que precisamos e adiciona configuração de build. O SW próprio tem cerca de 80 linhas e regras explícitas para `/v1`.

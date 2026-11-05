# Segurança — controles e mapeamento ISO/IEC 27001:2022 (Anexo A)

> Documento vivo: mapeia os controles REAIS deste projeto (não um modelo genérico) aos controles de
> referência do Anexo A da ISO/IEC 27001:2022. "Implementado" significa que existe código/configuração
> funcionando e testado — ver a coluna "Evidência". Seções de lacunas são honestas de propósito.

## 1. Controles organizacionais (A.5)

| Controle | O que existe | Evidência |
| --- | --- | --- |
| A.5.1 Políticas de segurança | `CLAUDE.md`, esta página, ADRs | `docs/adr/` |
| A.5.9 Inventário de ativos de informação | Catálogo de permissões (`public.permissions`), schema versionado (`packages/db/src/schema/`) | `packages/db/src/schema/index.ts` |
| A.5.10 Uso aceitável da informação | Política de senha/sessão/IP configurável por tenant | `apps/api/src/modules/identity/application/security-policy.service.ts` |
| A.5.15 Controle de acesso | RBAC em 5 níveis (tenant/workspace/board/view/coluna/item), papéis customizáveis e clonáveis | `docs/permissions.md`, `effective-access.ts` |
| A.5.16 Gestão de identidade | Usuário global (ADR premissa P2), SSO SAML 2.0, SCIM 2.0, OAuth (Google/Microsoft), magic link, senha+MFA TOTP | `apps/api/src/modules/identity/`, `apps/api/src/modules/sso/` |
| A.5.17 Informação de autenticação | Argon2id (senha), AES-256-GCM (segredos/certificados, BYOK), hash SHA-256 (tokens) | `core/crypto/password.ts`, `@cube-track/shared/crypto` |
| A.5.18 Direitos de acesso | RBAC + convite + SCIM; teto de escopo para token de API | `api-scope-map.ts` |
| A.5.23 Segurança para uso de serviços em nuvem | S3/MinIO compatível, Redis, PostgreSQL gerenciados via Helm/K8s (ver `docs/deploy.md`, entrega de infraestrutura paralela a esta) | `infra/` |
| A.5.24 Planejamento e preparação para gestão de incidentes | Trilha de auditoria encadeada por hash (`audit_logs`, `app.verify_audit_chain`), busca/exportação | `docs/adr/0057-...md`, `AuditService` |
| A.5.31 Requisitos legais/regulatórios | LGPD (consentimento, portabilidade, exclusão) | `docs/lgpd.md` |
| A.5.34 Privacidade e proteção de PII | `docs/lgpd.md` completo | `docs/lgpd.md` |
| A.5.35/36 Revisão independente / conformidade | Este documento + ADRs são a revisão formal disponível nesta entrega; **sem auditoria externa realizada** (lacuna) | — |

## 2. Controles de pessoas (A.6)

| Controle | O que existe | Lacuna |
| --- | --- | --- |
| A.6.3 Conscientização, educação e treinamento | — | Sem programa formal (fora do escopo de uma plataforma de software) |
| A.6.6 Acordos de confidencialidade | — | Fora do escopo do código |
| A.6.7 Trabalho remoto | Sessões com timeout de inatividade/vida útil absoluta configuráveis, allowlist de IP/domínio por tenant | `apps/api/src/modules/identity/application/session.service.ts` |

## 3. Controles físicos (A.7)

Não aplicável a este repositório (a infraestrutura física é do provedor de nuvem escolhido na
implantação — ver `docs/deploy.md`).

## 4. Controles tecnológicos (A.8)

| Controle | O que existe | Evidência |
| --- | --- | --- |
| A.8.1 Dispositivos endpoint do usuário | — | Fora do escopo (SaaS, sem agente instalado) |
| A.8.2 Direitos de acesso privilegiados | Papéis `owner`/`admin` + permissões granulares; `roles.manage` exige elas mesmas para se auto-conceder | `provisioning.ts` |
| A.8.3 Restrição de acesso à informação | RLS (`FORCE ROW LEVEL SECURITY`) em TODA tabela de negócio — papel de aplicação (`app_rw`) nunca tem `BYPASSRLS`; visibilidade de item por órgão para convidados (ADR 0057) | `packages/db/migrations/0002_rls_and_triggers.sql`, `effective-access.ts` |
| A.8.5 Autenticação segura | Argon2id, MFA TOTP + códigos de recuperação, SSO SAML 2.0 (verificação de assinatura via `@node-saml/node-saml`), bloqueio após 5 tentativas | `apps/api/src/modules/identity/`, `apps/api/src/modules/sso/` |
| A.8.8 Gestão de vulnerabilidades técnicas | SCA (`pnpm audit`, falha em high/critical) e SAST (Semgrep, `p/default` + `p/owasp-top-ten`) em CI | `.github/workflows/security.yml` (entrega paralela de infraestrutura, Track A — documentado aqui porque é o controle A.8.8) |
| A.8.9 Gestão de configuração | Infraestrutura como código (Helm/Docker Compose), schema versionado (migrações Drizzle) | `infra/`, `packages/db/migrations/` |
| A.8.12 Prevenção de vazamento de dados | Segredos/certificados sempre cifrados em repouso (nunca devolvidos em texto puro pela API — `hasCertificate`/`hasApiKey` em vez do valor) | `sso-config.service.ts`, `ai-settings.service.ts` |
| A.8.15 Registro (log) | `audit_logs` (encadeada por hash, append-only por trigger), logs estruturados (pino), OpenTelemetry | `docs/adr/0015-...md` (auditoria, Prompt 2), `core/logging/` |
| A.8.16 Atividades de monitoramento | OpenTelemetry + Prometheus/Grafana (entrega paralela de observabilidade, Track A) | `infra/observability/` |
| A.8.20 Segurança de redes | Allowlist de IP/domínio por tenant (login); CORS restrito a origens configuradas; `trust proxy` + rate limiting por IP/usuário/token em TODA requisição | `bootstrap.ts`, `core/rate-limit/rate-limit.ts` |
| A.8.22 Segregação de redes | Papéis de banco distintos por responsabilidade (`app_rw` RLS normal, `app_auth` tabelas globais de identidade, `app_relay` outbox) — nenhum tem `BYPASSRLS` | `docs/adr/0028-...md` |
| A.8.23 Filtragem na web | CSP restrita a `'self'` (+ `'unsafe-inline'` só em `style-src`, para o Swagger UI embutido), `X-Content-Type-Options`, `frame-ancestors 'none'`, HSTS (`helmet`) | `apps/api/src/bootstrap.ts` |
| A.8.24 Uso de criptografia | AES-256-GCM (segredos: certificado SAML, chave de IA, webhook), Argon2id (senha), SHA-256 (tokens de API/magic link/refresh), RSA-SHA256 + XML-DSig (verificação de assinatura SAML) | `@cube-track/shared/crypto`, `core/crypto/password.ts` |
| A.8.25 Ciclo de vida de desenvolvimento seguro | Clean Architecture/DDD por módulo, Zod na borda de toda mutação, testes de integração sob RLS real (nunca `BYPASSRLS`) | `CLAUDE.md`, `packages/testing/` |
| A.8.26 Requisitos de segurança de aplicações | Ver §5 (OWASP Top 10) abaixo | — |
| A.8.28 Codificação segura | ESLint com regras de null-safety estritas (`exactOptionalPropertyTypes`, proíbe asserção não-nula em favor de checagem em runtime), TypeScript `strict` | `packages/config/` |
| A.8.29 Testes de segurança em desenvolvimento e aceitação | Testes de verificação de assinatura SAML contra um certificado/chave REAIS (nunca mockados), testes de fail-safe (allowlist de IP/domínio, visibilidade por órgão, provisionamento SSO sem conta) | `apps/api/test/sso.e2e.test.ts`, `effective-access.test.ts` |
| A.8.33 Informação de teste | Bancos de teste isolados por execução, sem `BYPASSRLS` | `packages/testing/` |

## 5. OWASP Top 10 (2021) — revisão desta entrega

| Categoria | Situação |
| --- | --- |
| A01 Quebra de controle de acesso | RBAC em 5 níveis + RLS (defesa em profundidade: mesmo um bug no RBAC da aplicação não vaza dado entre tenants, porque o banco também aplica). Visibilidade de item por órgão sempre fail-safe (nunca "mais aberto" por omissão). |
| A02 Falhas criptográficas | Segredos sempre cifrados (nunca texto puro em repouso nem na resposta da API); TLS é responsabilidade da borda de rede na implantação (`docs/deploy.md`). |
| A03 Injeção | Spot-check confirma: toda consulta usa o `sql` com template parametrizado do Drizzle (nunca concatenação de string) ou `.where(eq(...))` tipado. Única exceção encontrada: `packages/db/src/scripts/benchmark.ts` usa `sql.raw` sobre UUIDs gerados internamente (nunca entrada de usuário) — script de desenvolvimento, não alcançável por nenhum endpoint. |
| A04 Design inseguro | Fail-safe deliberado em toda superfície nova desta entrega (ver ADR 0057) — a opção mais restritiva é sempre a de fallback, nunca a mais permissiva. |
| A05 Configuração incorreta de segurança | `helmet` com CSP restrita (`bootstrap.ts`), `trust proxy` explícito, `x-powered-by` desabilitado, CORS restrito a origens configuradas. |
| A06 Componentes vulneráveis e desatualizados | SCA (`pnpm audit --audit-level=high`) em CI, semanal + a cada push/PR (`.github/workflows/security.yml`). |
| A07 Falhas de identificação e autenticação | Argon2id, bloqueio após 5 tentativas, MFA TOTP, política de senha/sessão configurável, SSO SAML 2.0 com verificação de assinatura real. |
| A08 Falhas de integridade de software e dados | `audit_logs` encadeada por hash (`app.audit_hash`/`app.verify_audit_chain`) — qualquer adulteração retroativa é detectável. |
| A09 Falhas de registro e monitoramento | Auditoria completa de mutações (`@Audited`, verificado por teste automatizado — `toda rota que altera dados é auditada`), agora pesquisável/exportável (`GET /v1/audit/entries`). |
| A10 Server-Side Request Forgery (SSRF) | O `metadataUrl` de SSO (`sso_configurations`) é só informativo nesta entrega — a API nunca o busca (o admin cola o certificado/URLs diretamente), então não é uma superfície de SSRF. O ponto de risco real e PRÉ-EXISTENTE (fora desta entrega) é a entrega de webhooks de saída do Prompt 10/15, que de fato chama a URL configurada pelo tenant — **ainda não valida o destino contra IPs privados/metadados de nuvem**. Lacuna real, não introduzida nem corrigida aqui — ver §6. |

### CSRF (confirmado, não uma lacuna)

Cookie-autenticado é usado SÓ para o refresh token (`ct_refresh`, `httpOnly`, `SameSite=Lax`,
`Secure` em produção) — toda mutação de negócio exige um `Authorization: Bearer` que um site de
terceiros não consegue anexar automaticamente (diferente de um cookie). O endpoint que de fato lê o
cookie (`POST /v1/auth/refresh`) só EMITE uma sessão nova; não muda dado de negócio algum. Essa
separação (cookie só para refresh, Bearer para tudo o mais) já é, por construção, uma defesa contra
CSRF — nenhuma mudança foi necessária.

## 6. Lacunas conhecidas desta entrega (honestas)

- **SSRF em URLs de webhook de saída/integração** (Prompts 10/15, pré-existentes): nenhuma validação
  de destino (bloqueio de IPs privados/`169.254.169.254`/etc.) antes de chamar uma URL configurada
  pelo tenant. Risco real se uma conta comprometida com `webhook.manage`/`integrations.manage`
  apontar para um endpoint interno. Não introduzido nem corrigido nesta entrega — fora do escopo de
  Track B (identidade/SSO/auditoria/LGPD), mas vale registrar aqui por ser um achado de revisão
  OWASP A10 válido para todo o produto. Próximo passo recomendado: validar o destino antes de
  qualquer `fetch`/`axios` de URL configurada por usuário, em qualquer módulo que já faça isso hoje.
- **SLO SAML e assinatura de AuthnRequest pelo SP**: não implementados (ADR 0057, §SSO).
- **Allowlist de IP/domínio só no login**, não a cada requisição subsequente (custo de desempenho
  de abrir uma transação a cada requisição para checar — ADR 0057).
- **Exportação LGPD parcial**: comentários/itens responsável/apontamentos de horas não incluídos
  (`docs/lgpd.md` §3).
- **SCIM Groups somente leitura**: CRUD de times já era fora de escopo desde o Prompt 11.
- **Retenção de auditoria com granularidade mensal**, não por dia exato (`docs/lgpd.md` §5).
- **Sem auditoria de segurança externa/pentest** realizada sobre este código.
- **CodeQL não usado** (Semgrep foi escolhido por não exigir GitHub Advanced Security habilitado,
  incerto neste ambiente se o repositório é público ou privado) — se o repositório tiver Advanced
  Security disponível, adicionar CodeQL é um reforço recomendado, não obrigatório (Semgrep com
  `p/owasp-top-ten` já cobre boa parte da mesma superfície).

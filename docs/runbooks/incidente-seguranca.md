# Runbook — incidente de segurança (suspeita de vazamento de credencial)

Use este runbook para: `ENCRYPTION_KEY` possivelmente exposta, `JWT_SECRET` possivelmente
exposto, um token de API/OAuth de um usuário possivelmente vazado, ou um segredo de
integração/webhook possivelmente comprometido.

## Sintomas / gatilhos

- `ENCRYPTION_KEY`, `JWT_SECRET` ou qualquer segredo do Secret do Kubernetes apareceu em um log,
  commit, PR, mensagem de erro ou screenshot compartilhado.
- Uso anômalo de um `api_tokens`/OAuth app (Prompt 15) fora do padrão esperado do tenant.
- Alerta de scanner de segredo (GitHub secret scanning, se habilitado no repositório) ou de SAST
  (`.github/workflows/security.yml`) apontando um segredo commitado.
- Um provedor de integração (Google/Microsoft/Slack/GitHub etc.) avisa sobre uso incomum do
  client secret do CUBE TRACK.

## Diagnóstico — o que está em risco

Todo segredo em repouso na aplicação é cifrado com AES-256-GCM via `encryptSecret`/`decryptSecret`
(`packages/shared/src/crypto.ts`), usando a **mesma** `ENCRYPTION_KEY` na api e no worker. Se a
`ENCRYPTION_KEY` vazou, **todo** valor abaixo deve ser tratado como comprometido — listei as 10
colunas `*_ciphertext` do schema (`packages/db/src/schema/`) que essa chave protege, enumeradas
por grep em todo o repositório:

| Tabela | Coluna | O que guarda |
| --- | --- | --- |
| `users` | `mfa_secret_ciphertext` | Segredo TOTP de MFA ativo |
| `users` | `mfa_pending_secret_ciphertext` | Segredo TOTP de MFA em enrolamento (ainda não confirmado) |
| `ai_settings` | `api_key_ciphertext` | Chave de API do provedor de IA do workspace (ex.: Anthropic) |
| `webhooks` | `secret_ciphertext` | Segredo HMAC de assinatura de webhooks de automação (saída) |
| `integration_apps` | `client_secret_ciphertext` | Client secret OAuth do app de integração (Google/Microsoft/Slack/GitHub etc.) |
| `integration_connections` | `access_token_ciphertext` | Token de acesso OAuth de uma conexão de integração de um usuário |
| `integration_connections` | `refresh_token_ciphertext` | Token de refresh OAuth da mesma conexão |
| `integration_connections` | `webhook_secret_ciphertext` | Segredo para validar webhooks de ENTRADA do provedor |
| `integration_connections` | `outbound_webhook_url_ciphertext` | URL de webhook de saída configurada pelo usuário (pode conter token na query string) |
| `oauth_apps` | `client_secret_ciphertext` | Client secret de um OAuth app da API pública do CUBE TRACK (Prompt 15) |

(Se um agente concorrente adicionar uma coluna `*_ciphertext` nova depois deste prompt, ela entra
nesta lista também — reconfira com `grep -rn "Ciphertext" packages/db/src/schema/` antes de
declarar este runbook aplicado por completo.)

Segredos **fora** desse mecanismo de cifra, que também precisam rotação se vazarem:

- `JWT_SECRET` — compromete todo access/refresh token já emitido (seção "Procedimento" item 2).
- Senhas de usuário — já são hash Argon2id (`@node-rs/argon2`), não reversível; vazamento da
  própria tabela `users.password_hash` não exige rotação de `ENCRYPTION_KEY`, mas exige forçar
  reset de senha dos usuários afetados.
- Credenciais de infraestrutura fora da aplicação (`DATABASE_*_URL`, `REDIS_URL`, `S3_*`,
  `MEILI_MASTER_KEY`, `BULL_BOARD_PASSWORD`) — não passam por `encryptSecret`, vivem só no Secret
  do Kubernetes/gerenciador de segredos.

## Procedimento

1. **Conter:** se o vazamento é de um commit/PR público, revogar o acesso do repositório ou
   remover o conteúdo imediatamente (histórico do git não reescreve segredo já vazado — trate o
   valor como permanentemente comprometido, rotação é obrigatória independente de remover o
   commit).

2. **`ENCRYPTION_KEY` comprometida — rotação:**
   a. Gerar uma chave nova: `openssl rand -base64 32`.
   b. **Não basta trocar a env var** — todo valor `*_ciphertext` listado acima foi cifrado com a
      chave antiga; trocar a chave sem re-cifrar torna `decryptSecret` falhar para esses
      registros (perda de acesso a MFA, integrações, webhooks).
   c. Procedimento seguro (API/worker ficam momentaneamente com `ENCRYPTION_KEY_PREVIOUS` até a
      re-cifra terminar — isso é uma mudança de código fora do escopo deste runbook de infra; se
      ainda não existir suporte a duas chaves simultâneas no código de `encryptSecret`/
      `decryptSecret`, abra uma tarefa de aplicação para isso antes de rotacionar em produção):
      1. Decifrar cada linha das 10 colunas com a chave antiga.
      2. Re-cifrar com a chave nova.
      3. Atualizar o Secret do Kubernetes (`ENCRYPTION_KEY`) com a chave nova.
      4. `helm upgrade` para os pods pegarem a chave nova.
      5. Confirmar que MFA, integrações e webhooks de um tenant de teste continuam funcionando
         antes de considerar concluído.
   d. Enquanto isso não roda, todo usuário com MFA ativo fica bloqueado de novo login até
      reconfigurar — avise o suporte antes de rotacionar em horário de pico.

3. **`JWT_SECRET` comprometida — rotação:**
   a. Gerar uma chave nova (`openssl rand -base64 48`), atualizar o Secret, `helm upgrade`.
   b. Toda sessão ativa é invalidada (os tokens antigos não verificam mais contra a chave nova) —
      todo usuário precisa logar de novo. Avise antes.
   c. Revogar explicitamente os refresh tokens na tabela `sessions` (whitelist/blacklist conforme
      o mecanismo implementado em `apps/api/src/modules/identity`) para impedir reuso do token
      antigo enquanto a troca de chave não se propaga a todos os pods.

4. **Token de integração/API específico comprometido** (não a chave mestra, um token pontual):
   revogar direto na tabela (`integration_connections.access_token_ciphertext` /
   `refresh_token_ciphertext` → null, forçando reconexão OAuth) ou, se for um `api_tokens`/
   `oauth_apps` do Prompt 15, revogar pela própria funcionalidade de gestão de tokens da API (não
   precisa rotacionar `ENCRYPTION_KEY` inteira para isso).

5. **Registrar o incidente:** toda ação acima gera entrada em auditoria
   (`appendAuditLog`, CLAUDE.md §4) automaticamente pelas rotinas normais de revogação/alteração —
   confirme que aparece. Além disso, documentar à parte (fora deste repo, no canal de segurança do
   time): o que vazou, quando, janela de exposição, o que foi rotacionado, usuários afetados.

## Prevenção

- `.github/workflows/security.yml` roda SAST (Semgrep) e SCA (`pnpm audit`) em todo push/PR —
  pega segredo commitado por engano em regras que casam padrões de chave/token, mas não substitui
  revisão humana de PR.
- Nunca colocar um valor de segredo real em `values-*.yaml` do Helm (só referências a `Secret`
  externo) — reforçado em `infra/helm/cube-track/README.md`.
- `.dockerignore` e `.gitignore` já excluem `.env` (só `.env.example`, sem valores reais, é
  versionado).

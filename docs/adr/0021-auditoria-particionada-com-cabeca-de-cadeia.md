# ADR 0021 — Auditoria particionada por mês com cabeça de cadeia por tenant

- **Status:** Aceita (detalha a ADR 0015)
- **Data:** 2026-10-14
- **Prompt:** 2

## Contexto

A ADR 0015 definiu auditoria append-only com hash encadeado. Faltava decidir como particionar, como encadear sob concorrência e como garantir imutabilidade inclusive contra o dono do schema.

## Decisão

- `audit_logs` é **particionada por `RANGE (created_at)` mensal**, criada por SQL manual (o drizzle-kit não gera tabelas particionadas; o arquivo `schema/audit.ts` existe só para tipagem e fica fora do diff). Partições criadas por `app.ensure_audit_partitions()` (25 meses na migração; o worker mantém a janela) + partição `DEFAULT` de segurança.
- **Encadeamento por tenant** com `chain_seq` contínuo: o trigger `BEFORE INSERT` trava a linha do tenant em `audit_chain_heads`, calcula `hash = sha256(prev_hash || conteúdo canônico)` e atualiza a cabeça. O conteúdo canônico usa `jsonb::text` (normalizado pelo PostgreSQL) e timestamps em UTC com microssegundos.
- **Imutabilidade em camadas:** `UPDATE/DELETE/TRUNCATE` revogados dos papéis da aplicação; triggers que bloqueiam essas operações até para o dono; partições sem privilégios diretos e com RLS sem políticas.
- **Verificação:** `app.verify_audit_chain(tenant)` lista registros cujo hash, `prev_hash` ou sequência não conferem.
- **Retenção:** partições antigas são exportadas para storage WORM e removidas com `DETACH PARTITION` + `DROP` pelo migrator (operação de plataforma, auditada).

## Alternativas consideradas

- **Advisory lock por tenant** em vez de tabela de cabeça: equivalente em serialização, mas exigiria varrer a última linha para obter o hash anterior.
- **Hash por registro sem encadeamento**: não detecta remoção/reordenação.
- **Selagem assíncrona em lotes (worker)**: elimina a serialização por tenant, mas abre janela sem proteção. Fica como evolução se a serialização virar gargalo (monitorar tempo de espera de lock em `audit_chain_heads`).

## Consequências

- Escritas auditadas de um mesmo tenant serializam no trecho final da transação (custo pequeno; transações devem ser curtas).
- Desabilitar triggers exige superusuário/dono e é detectado pela verificação da cadeia (coberto por teste).

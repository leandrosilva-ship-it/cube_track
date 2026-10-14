# ADR 0008 — Resolução de conflitos: LWW por campo + comandos condicionais + CRDT (Yjs) para rich text

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
Muitos usuários editam o mesmo board simultaneamente. Precisamos de semântica previsível, simples de explicar e barata, sem perder edições em textos longos.

## Decisão
- **Valores de coluna: Last-Writer-Wins por campo**, com o **servidor como árbitro** (ordem de commit). Cada campo tem `version` em `items.field_versions`. Edições em campos diferentes do mesmo item nunca conflitam.
- **Campos com regra** (transição de workflow, obrigatórios por fase, aprovações, valores de módulo contratual): **comando condicional** com `baseVersion`; divergência ⇒ HTTP 409 com estado atual; o cliente faz rollback e reapresenta.
- **Coleções** (pessoas, tags, dependências): operações `add`/`remove` comutativas em vez de substituir o array.
- **Posição**: fractional indexing (ADR 0013) com desempate por id.
- **Rich text** (descrição, documentos, atualizações em edição colaborativa): **Yjs** com **Tiptap** no cliente e **Hocuspocus** no servidor (em `apps/realtime`, path `/collab`); persistência do estado Yjs binário em PostgreSQL + projeção HTML sanitizado/texto para busca e exibição.
- **Updates otimistas** com `clientMutationId` e rollback em rejeição; idempotência no servidor (24 h).

## Alternativas consideradas
- **CRDT para tudo** (documento Yjs por board): resolve tudo localmente, mas dificulta validação de regras no servidor, autorização por coluna, auditoria por campo e consultas SQL.
- **OT (Operational Transform)**: complexo, exige servidor central de transformação; Yjs é o padrão de mercado para rich text.
- **Lock pessimista por item**: péssima UX colaborativa.

## Consequências
- UI mostra "editado por Fulano agora" quando um valor local é sobrescrito.
- Auditoria registra cada mudança de campo com versão anterior e nova.

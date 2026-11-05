import { sql, type SQL } from 'drizzle-orm';

/**
 * Comparador único de "item pertence ao órgão/departamento X" (ADR 0057, visibilidade de item por
 * órgão para convidados). Usado tanto na listagem de itens (`work/infrastructure/item-query.ts`,
 * filtro em massa) quanto na checagem de um item isolado (`AccessRepository.itemMatchesOrgUnit`) —
 * UM comparador, nunca dois reimplementados em paralelo.
 *
 * Comparação sempre textual e exata (case-insensitive): o rótulo da opção/status ou o texto livre da
 * coluna precisa ser IGUAL ao `org_unit` declarado do convidado.
 */
export interface OrgMatchColumn {
  id: string;
  key: string;
  type: string;
}

const TEXT_LIKE_TYPES = new Set([
  'text',
  'long_text',
  'link',
  'email',
  'phone',
  'country',
  'color',
  'hour',
  'location',
]);

/**
 * Condição SQL "o item (identificado por `itemId`/`values`) tem, na coluna `column`, um valor igual a
 * `orgUnit`". `itemId`/`values` são expressões SQL arbitrárias (alias de uma lista, ou um valor
 * literal para um único item) para permitir reúso nos dois contextos de chamada.
 */
export function orgUnitMatchCondition(args: {
  itemId: SQL;
  values: SQL;
  column: OrgMatchColumn;
  orgUnit: string;
}): SQL {
  const { itemId, values, column, orgUnit } = args;
  const key = column.key;
  switch (column.type) {
    case 'status':
      return sql`exists (
        select 1 from status_labels sl
        where sl.column_id = ${column.id}::uuid
          and sl.deleted_at is null
          and lower(sl.label) = lower(${orgUnit})
          and sl.id = nullif(${values} -> ${key} ->> 'labelId', '')::uuid
      )`;
    case 'dropdown':
      return sql`exists (
        select 1 from dropdown_options do_
        where do_.column_id = ${column.id}::uuid
          and do_.deleted_at is null
          and lower(do_.label) = lower(${orgUnit})
          and (${values} -> ${key} -> 'optionIds') ? (do_.id::text)
      )`;
    default: {
      if (!TEXT_LIKE_TYPES.has(column.type)) return sql`false`;
      // A projeção de texto (`item_field_index.v_text`) é guardada em minúsculas (mesmo padrão do
      // compilador de filtros, `work/infrastructure/item-query.ts`).
      return sql`exists (
        select 1 from item_field_index f
        where f.item_id = ${itemId}
          and f.column_key = ${key}
          and f.v_text = ${orgUnit.trim().toLowerCase()}
      )`;
    }
  }
}

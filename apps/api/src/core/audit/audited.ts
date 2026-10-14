import { SetMetadata } from '@nestjs/common';

export interface AuditedSpec {
  /** Ação de auditoria (ex.: `item.update`). */
  action: string;
  entityType: string;
  /**
   * `true` (padrão): o interceptor abre a transação de escrita com contexto do tenant e grava a
   * auditoria. `false`: o caso de uso gerencia transação e auditoria (fluxos de autenticação).
   */
  transactional?: boolean;
}

export const AUDITED_METADATA = 'cube:audited';

/** Toda rota que altera dados DEVE ter `@Audited` (verificado por teste automatizado). */
export const Audited = (spec: AuditedSpec) => SetMetadata(AUDITED_METADATA, spec);

export const READ_ONLY_METADATA = 'cube:read-only';

/** POST que apenas consulta (ex.: verificação de permissão, busca): transação somente leitura, sem auditoria. */
export const ReadOnlyOperation = () => SetMetadata(READ_ONLY_METADATA, true);

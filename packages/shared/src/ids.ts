import { v7 as uuidv7, validate, version } from 'uuid';

/** Gera um identificador UUIDv7 (ordenado por tempo) — ADR 0014. */
export function newId(): string {
  return uuidv7();
}

/** Indica se o valor é um UUID válido na versão 7. */
export function isUuidV7(value: string): boolean {
  return validate(value) && version(value) === 7;
}

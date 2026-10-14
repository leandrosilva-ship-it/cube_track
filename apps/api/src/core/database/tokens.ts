/** Conexão da aplicação (papel app_rw — sujeito a RLS). */
export const APP_DB = Symbol('APP_DB');
/** Conexão de autenticação (papel app_auth — tabelas de identidade, ADR 0028). */
export const AUTH_DB = Symbol('AUTH_DB');

import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

/** Negociação de idioma (Accept-Language + cookie) e reescrita das rotas localizadas. */
export default createMiddleware(routing);

export const config = {
  // Tudo, exceto a API (proxy), assets do Next e arquivos estáticos.
  matcher: ['/((?!v1|_next|_vercel|sw\\.js|manifest\\.webmanifest|.*\\..*).*)'],
};

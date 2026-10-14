import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/** Link/router cientes do idioma: navegação client-side sem recarregar a página. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

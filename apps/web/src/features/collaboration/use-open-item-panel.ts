'use client';

import { usePathname, useRouter } from '@/i18n/navigation';

/** Abre o painel do item (`?item=<id>`) a partir da Tabela, do Kanban ou de qualquer outra lista. */
export function useOpenItemPanel(): (itemId: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return (itemId: string) => {
    router.push(`${pathname}?item=${itemId}`, { scroll: false });
  };
}

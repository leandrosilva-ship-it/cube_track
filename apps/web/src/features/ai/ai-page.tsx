import { Badge, EmptyState } from '@cube-track/ui';
import { Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';

/** Entrada do assistente de IA: o módulo é opcional e habilitado pela organização (Prompt 14). */
export async function AiPage() {
  const t = await getTranslations('ai');
  return (
    <div className="pb-10">
      <PageHeader title={t('title')} />
      <div className="px-4 sm:px-8">
        <EmptyState
          icon={<Sparkles aria-hidden="true" />}
          title={t('title')}
          description={t('description')}
          action={<Badge tone="warning">{t('notEnabled')}</Badge>}
        />
      </div>
    </div>
  );
}

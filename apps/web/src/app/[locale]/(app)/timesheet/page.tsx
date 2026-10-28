import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { TimesheetPage } from '@/features/timesheet/timesheet-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('timesheet');
  return { title: t('title') };
}

export default function Page() {
  return <TimesheetPage />;
}

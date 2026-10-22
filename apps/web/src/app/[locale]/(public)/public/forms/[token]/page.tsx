import { PublicFormPage } from '@/features/forms/public-form-page';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicFormPage token={token} />;
}

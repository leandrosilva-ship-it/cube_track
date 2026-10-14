'use client';

import { Button, Field, Input, Skeleton } from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';

import { FormMessage } from '@/components/common/form-error';
import { Link } from '@/i18n/navigation';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { authApi } from '../api';
import { useCompleteSignIn } from '../use-complete-sign-in';

export function InviteForm() {
  const t = useTranslations('auth');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const token = useSearchParams().get('token') ?? '';
  const complete = useCompleteSignIn();
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => authApi.invitation(token),
    enabled: token !== '',
    retry: false,
  });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  if (token === '' || preview.isError) {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage>{t('invite.invalid')}</FormMessage>
        <Button asChild variant="secondary">
          <Link href="/login">{t('forgot.backToLogin')}</Link>
        </Button>
      </div>
    );
  }
  if (preview.data === undefined) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  const invitation = preview.data;

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const nextErrors: { name?: string; password?: string } = {};
    if (!invitation.accountExists && name.trim().length < 2) nextErrors.name = tv('required');
    if (!invitation.accountExists && password.length < 10)
      nextErrors.password = tv('passwordLength');
    if (invitation.accountExists && password === '') nextErrors.password = tv('required');
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await authApi.acceptInvitation({
        token,
        password,
        ...(invitation.accountExists ? {} : { name: name.trim() }),
      });
      await complete(session, '/');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">
          {t('invite.title', { organization: invitation.organization.name })}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">{invitation.email}</p>
      </div>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        <FormMessage>{error}</FormMessage>
        {invitation.accountExists ? (
          <p className="text-sm text-fg-muted">{t('invite.existingAccount')}</p>
        ) : (
          <Field label={t('invite.name')} error={fieldErrors.name}>
            <Input
              autoComplete="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
        )}
        <Field
          label={invitation.accountExists ? t('password') : t('invite.password')}
          error={fieldErrors.password}
          {...(invitation.accountExists ? {} : { hint: tv('passwordLength') })}
        >
          <Input
            type="password"
            autoComplete={invitation.accountExists ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
        <Button type="submit" size="lg" loading={submitting}>
          {t('invite.accept')}
        </Button>
      </form>
    </div>
  );
}

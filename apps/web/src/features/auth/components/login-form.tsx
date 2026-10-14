'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, Input } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod/mini';

import { FormMessage } from '@/components/common/form-error';
import { Link, useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { authApi, isMfaChallenge } from '../api';
import { useCompleteSignIn } from '../use-complete-sign-in';

export function LoginForm() {
  const t = useTranslations('auth');
  const tv = useTranslations('validation');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const complete = useCompleteSignIn();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendingLink, setSendingLink] = useState(false);

  const schema = z.object({
    email: z.email(tv('email')),
    password: z.string().check(z.minLength(1, tv('required'))),
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const submit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    // Lido no envio (não via useSearchParams): a página é pré-renderizada por completo no servidor.
    const next = new URLSearchParams(window.location.search).get('next');
    try {
      const response = await authApi.login(email, password);
      if (isMfaChallenge(response)) {
        const query = new URLSearchParams({ challenge: response.challengeToken });
        if (next !== null) query.set('next', next);
        router.push(`/auth/mfa?${query.toString()}`);
        return;
      }
      await complete(response, next);
    } catch (caught) {
      if (isApiError(caught, 401)) setError(t('login.invalid'));
      else if (isApiError(caught, 423)) setError(t('login.locked'));
      else setError(errorMessage(caught));
    }
  });

  const sendMagicLink = async () => {
    const valid = await form.trigger('email');
    if (!valid) return;
    setSendingLink(true);
    setError(null);
    try {
      await authApi.requestMagicLink(form.getValues('email'));
      setNotice(t('login.magicLinkSent'));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSendingLink(false);
    }
  };

  const { errors, isSubmitting } = form.formState;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">{t('login.title')}</h1>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" asChild>
          <a href="/v1/auth/oauth/google">{t('google')}</a>
        </Button>
        <Button variant="secondary" asChild>
          <a href="/v1/auth/oauth/microsoft">{t('microsoft')}</a>
        </Button>
      </div>
      <div className="flex items-center gap-3 text-xs text-fg-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        {t('or')}
        <span className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormMessage>{error}</FormMessage>
        <FormMessage tone="success">{notice}</FormMessage>
        <Field
          label={t('email')}
          error={errors.email?.message}
          required
          requiredLabel={tc('required')}
        >
          <Input type="email" autoComplete="email" inputMode="email" {...form.register('email')} />
        </Field>
        <Field
          label={t('password')}
          error={errors.password?.message}
          required
          requiredLabel={tc('required')}
        >
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        <div className="flex justify-end">
          <Link
            href="/auth/forgot-password"
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('login.forgot')}
          </Link>
        </div>
        <Button type="submit" size="lg" loading={isSubmitting}>
          {t('login.submit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          loading={sendingLink}
          onClick={() => void sendMagicLink()}
        >
          {t('login.magicLink')}
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        {t('login.noAccount')}{' '}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          {t('login.signup')}
        </Link>
      </p>
    </div>
  );
}

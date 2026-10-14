'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, Input } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import * as z from 'zod/mini';

import { FormMessage } from '@/components/common/form-error';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { authApi } from '../api';
import { useCompleteSignIn } from '../use-complete-sign-in';

/** "Prefeitura de São Paulo" → "prefeitura-de-sao-paulo". */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export function SignupForm() {
  const t = useTranslations('auth');
  const tv = useTranslations('validation');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const complete = useCompleteSignIn();
  const [error, setError] = useState<string | null>(null);
  const [slugEdited, setSlugEdited] = useState(false);

  const schema = z.object({
    name: z.string().check(z.trim(), z.minLength(2, tv('required'))),
    email: z.email(tv('email')),
    password: z.string().check(z.minLength(10, tv('passwordLength'))),
    organizationName: z.string().check(z.trim(), z.minLength(2, tv('required'))),
    organizationSlug: z.string().check(z.regex(/^[a-z0-9][a-z0-9-]{1,62}$/, tv('slug'))),
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      organizationName: '',
      organizationSlug: '',
    },
  });
  const slug = useWatch({ control: form.control, name: 'organizationSlug' });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await complete(await authApi.signup(values), null);
    } catch (caught) {
      setError(isApiError(caught, 409) ? t('signup.taken') : errorMessage(caught));
    }
  });

  const { errors, isSubmitting } = form.formState;
  const organizationField = form.register('organizationName');
  const slugField = form.register('organizationSlug');
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">{t('signup.title')}</h1>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormMessage>{error}</FormMessage>
        <Field
          label={t('signup.name')}
          error={errors.name?.message}
          required
          requiredLabel={tc('required')}
        >
          <Input autoComplete="name" {...form.register('name')} />
        </Field>
        <Field
          label={t('email')}
          error={errors.email?.message}
          required
          requiredLabel={tc('required')}
        >
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field
          label={t('password')}
          error={errors.password?.message}
          hint={tv('passwordLength')}
          required
          requiredLabel={tc('required')}
        >
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field
          label={t('signup.organization')}
          error={errors.organizationName?.message}
          required
          requiredLabel={tc('required')}
        >
          <Input
            autoComplete="organization"
            {...organizationField}
            onChange={(event) => {
              void organizationField.onChange(event);
              if (!slugEdited)
                form.setValue('organizationSlug', slugify(event.target.value), {
                  shouldValidate: false,
                });
            }}
          />
        </Field>
        <Field
          label={t('signup.slug')}
          error={errors.organizationSlug?.message}
          hint={slug === '' ? undefined : t('signup.slugHint', { slug })}
          required
          requiredLabel={tc('required')}
        >
          <Input
            autoComplete="off"
            spellCheck={false}
            {...slugField}
            onChange={(event) => {
              setSlugEdited(true);
              void slugField.onChange(event);
            }}
          />
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting}>
          {t('signup.submit')}
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        {t('signup.hasAccount')}{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('signup.login')}
        </Link>
      </p>
    </div>
  );
}

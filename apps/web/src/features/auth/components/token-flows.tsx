'use client';

import { Button, Spinner } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { FormMessage } from '@/components/common/form-error';
import { Link, useRouter } from '@/i18n/navigation';
import { refreshSession } from '@/lib/auth/session';

import { authApi, isMfaChallenge } from '../api';
import { useCompleteSignIn } from '../use-complete-sign-in';

function Pending({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center" aria-live="polite">
      <Spinner size="lg" className="text-primary" />
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}

function BackToLogin() {
  const t = useTranslations('auth');
  return (
    <Button asChild variant="secondary" size="lg">
      <Link href="/login">{t('forgot.backToLogin')}</Link>
    </Button>
  );
}

/** Executa uma ação uma única vez por montagem (tokens de uso único não podem ser reenviados). */
function useOnce(action: () => Promise<void>) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void action();
  }, [action]);
}

export function MagicLinkVerifier() {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token') ?? '';
  const complete = useCompleteSignIn();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [action] = useState(() => async () => {
    try {
      const response = await authApi.verifyMagicLink(token);
      if (isMfaChallenge(response)) {
        router.replace(`/auth/mfa?challenge=${encodeURIComponent(response.challengeToken)}`);
        return;
      }
      await complete(response, null);
    } catch {
      setFailed(true);
    }
  });
  useOnce(action);
  return failed ? (
    <div className="flex flex-col gap-4">
      <FormMessage>{t('magic.invalid')}</FormMessage>
      <BackToLogin />
    </div>
  ) : (
    <Pending label={t('magic.verifying')} />
  );
}

export function EmailVerifier() {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'pending' | 'done' | 'failed'>('pending');
  const [action] = useState(() => async () => {
    try {
      await authApi.verifyEmail(token);
      setState('done');
    } catch {
      setState('failed');
    }
  });
  useOnce(action);
  if (state === 'pending') return <Pending label={t('verifyEmail.verifying')} />;
  return (
    <div className="flex flex-col gap-4">
      {state === 'done' ? (
        <FormMessage tone="success">{t('verifyEmail.done')}</FormMessage>
      ) : (
        <FormMessage>{t('verifyEmail.invalid')}</FormMessage>
      )}
      <Button asChild size="lg">
        <Link href="/">{t('login.submit')}</Link>
      </Button>
    </div>
  );
}

/** Retorno do OAuth: a API já gravou o cookie de refresh; renovamos para obter o access token. */
export function OAuthCallback() {
  const t = useTranslations('auth');
  const params = useSearchParams();
  const errorCode = params.get('error');
  const router = useRouter();
  const [failed, setFailed] = useState(errorCode !== null);
  const [action] = useState(() => async () => {
    if (errorCode !== null) return;
    if (await refreshSession()) router.replace('/');
    else setFailed(true);
  });
  useOnce(action);
  return failed ? (
    <div className="flex flex-col gap-4">
      <FormMessage>{t('callback.error', { code: errorCode ?? 'session' })}</FormMessage>
      <BackToLogin />
    </div>
  ) : (
    <Pending label={t('callback.signingIn')} />
  );
}

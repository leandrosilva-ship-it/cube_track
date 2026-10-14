'use client';

import {
  Avatar,
  Button,
  DialogClose,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
  toast,
} from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type SubmitEvent } from 'react';

import { api } from '@/lib/api/client';
import type { AccessGrant } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

import { useMembers, useRoles } from '../shell/hooks';

/** Convite por e-mail (membro ou convidado externo) — `POST /v1/invitations`. */
export function InviteDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations('board.inviteDialog');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const roles = useRoles();
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState<'member' | 'guest'>('member');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(tv('email'));
      return;
    }
    const role = (roles.data ?? []).find((entry) => entry.scope === 'tenant' && entry.key === kind);
    if (role === undefined) {
      setError(tc('unavailable'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api('/v1/invitations', {
        method: 'POST',
        body: {
          email,
          kind,
          roleId: role.id,
          ...(message.trim() === '' ? {} : { message: message.trim() }),
        },
      });
      toast.success(t('sent', { email }));
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={t('title')} description={t('description')} closeLabel={tc('close')}>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        <Field label={t('email')} error={error} required requiredLabel={tc('required')}>
          <Input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- campo principal do diálogo
            autoFocus
          />
        </Field>
        <Field label={t('kind')}>
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value as 'member' | 'guest');
            }}
            options={[
              { value: 'member', label: t('member') },
              { value: 'guest', label: t('guest') },
            ]}
          />
        </Field>
        <Field label={t('message')}>
          <Textarea
            value={message}
            maxLength={1000}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{tc('cancel')}</Button>
          </DialogClose>
          <Button type="submit" loading={submitting}>
            {t('send')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Link do board e pessoas com acesso explícito (concessões). */
export function ShareDialog({ boardId, canManage }: { boardId: string; canManage: boolean }) {
  const t = useTranslations('board.shareDialog');
  const tc = useTranslations('common');
  const members = useMembers();
  const grants = useQuery({
    queryKey: qk.grants('board', boardId),
    queryFn: () =>
      api<{ data: AccessGrant[] }>('/v1/access-grants', {
        query: { resourceType: 'board', resourceId: boardId },
      }).then((response) => response.data),
    enabled: canManage,
  });
  const roles = useRoles(canManage);
  const link = typeof window === 'undefined' ? '' : (window.location.href.split('?')[0] ?? '');
  const memberById = new Map((members.data ?? []).map((member) => [member.userId, member]));
  const roleById = new Map((roles.data ?? []).map((role) => [role.id, role]));
  return (
    <Modal title={t('title')} description={t('description')} closeLabel={tc('close')}>
      <div className="flex flex-col gap-5">
        <Field label={t('link')}>
          <div className="flex gap-2">
            <Input readOnly value={link} />
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => toast.success(tc('copied')));
              }}
            >
              <Copy aria-hidden="true" />
              {tc('copy')}
            </Button>
          </div>
        </Field>
        {canManage ? (
          <section aria-labelledby="share-people">
            <h3 id="share-people" className="mb-2 text-sm font-semibold">
              {t('people')}
            </h3>
            {grants.data === undefined ? (
              <Skeleton className="h-10" />
            ) : grants.data.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('noGrants')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {grants.data.map((grant) => {
                  const member = memberById.get(grant.principalId);
                  return (
                    <li key={grant.id} className="flex items-center gap-3 text-sm">
                      <Avatar
                        person={{
                          id: grant.principalId,
                          name: member?.name ?? grant.principalType,
                        }}
                        size="sm"
                        decorative
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {member?.name ?? grant.principalId}
                      </span>
                      <span className="text-fg-muted">
                        {roleById.get(grant.roleId)?.name ?? ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-fg-muted">{t('inherited')}</p>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

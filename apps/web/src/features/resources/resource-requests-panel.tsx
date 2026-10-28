'use client';

import { Badge, Button, Select, Skeleton } from '@cube-track/ui';
import { ClipboardList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useMembers } from '../shell/hooks';

import { useAssignOpenResourceRequest, useCancelOpenResourceRequest, useOpenResourceRequests } from './hooks';
import { formatHours } from './model';

/**
 * Fila de solicitações de recurso abertas em qualquer board do tenant (ADR 0052): o gestor de
 * recursos aloca uma pessoa ou cancela o pedido. Criar uma solicitação é feito a partir do board
 * (fora do escopo desta página de workspace).
 */
export function ResourceRequestsPanel() {
  const t = useTranslations('capacity');
  const requests = useOpenResourceRequests();
  const members = useMembers();
  const assign = useAssignOpenResourceRequest();
  const cancel = useCancelOpenResourceRequest();
  const [picked, setPicked] = useState<Record<string, string>>({});

  if (requests.data === undefined) return <Skeleton className="h-32" />;
  if (requests.data.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-fg-muted">
        <ClipboardList className="size-6" aria-hidden="true" />
        {t('requests.empty')}
      </div>
    );

  return (
    <ul className="flex flex-col gap-2">
      {requests.data.map((request) => (
        <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
          <div className="flex flex-col">
            <span className="font-medium">{request.roleTitle}</span>
            <span className="text-fg-muted">
              {formatHours(request.hours)}h · {request.startDate} → {request.endDate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="warning">{t('requests.status.open')}</Badge>
            <Select
              aria-label={t('requests.assignTo')}
              value={picked[request.id] ?? ''}
              onValueChange={(value) => {
                setPicked((prev) => ({ ...prev, [request.id]: value }));
              }}
              options={(members.data ?? []).map((member) => ({ value: member.userId, label: member.name }))}
              placeholder={t('requests.assignTo')}
            />
            <Button
              size="sm"
              disabled={picked[request.id] === undefined}
              onClick={() => {
                const assignedUserId = picked[request.id];
                if (assignedUserId !== undefined) assign.mutate({ id: request.id, assignedUserId });
              }}
            >
              {t('requests.assign')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                cancel.mutate(request.id);
              }}
            >
              {t('requests.cancel')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

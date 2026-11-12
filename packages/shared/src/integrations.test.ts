import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildGoogleCalendarEventBody,
  buildMicrosoftCalendarEventBody,
  extractItemReferences,
  isDoneLikeStatusLabel,
  isIntegrationProvider,
  normalizeAzureDevOpsEvent,
  normalizeGithubEvent,
  normalizeGitlabEvent,
  slackNotificationBlocks,
  teamsAdaptiveCard,
  verifyGithubSignature,
  verifySlackSignature,
} from './integrations.js';

describe('isIntegrationProvider', () => {
  it('aceita cada provedor conhecido', () => {
    for (const provider of ['google', 'microsoft', 'slack', 'teams', 'github', 'gitlab', 'azure_devops']) {
      expect(isIntegrationProvider(provider)).toBe(true);
    }
  });

  it('recusa um provedor desconhecido', () => {
    expect(isIntegrationProvider('bitbucket')).toBe(false);
  });
});

describe('extractItemReferences', () => {
  it('encontra tokens #algo e UUIDs numa mensagem de commit', () => {
    const refs = extractItemReferences('Corrige #OS-2026-0042 e também fecha 123e4567-e89b-12d3-a456-426614174000');
    expect(refs).toContain('OS-2026-0042');
    expect(refs).toContain('123e4567-e89b-12d3-a456-426614174000');
  });

  it('não encontra nada num texto sem referência', () => {
    expect(extractItemReferences('apenas um commit qualquer')).toEqual([]);
  });
});

describe('normalizeGithubEvent', () => {
  it('normaliza um push com commits', () => {
    const event = normalizeGithubEvent('push', {
      repository: { full_name: 'org/repo' },
      commits: [{ message: 'fix #42', url: 'https://github.com/org/repo/commit/abc', author: { name: 'Dev' } }],
    });
    expect(event?.kind).toBe('push');
    expect(event?.repo).toBe('org/repo');
    expect(event?.searchableText).toEqual(['fix #42']);
  });

  it('normaliza um pull_request fechado e mergeado', () => {
    const event = normalizeGithubEvent('pull_request', {
      repository: { full_name: 'org/repo' },
      action: 'closed',
      pull_request: { title: 'Fix #42', body: 'desc', html_url: 'https://x', merged: true, user: { login: 'dev' } },
    });
    expect(event?.kind).toBe('pull_request_merged');
  });

  it('lança quando falta o campo mínimo', () => {
    expect(() => normalizeGithubEvent('push', {})).toThrow();
  });

  it('retorna null para um tipo de evento sem handler (ex.: "star")', () => {
    expect(normalizeGithubEvent('star', { repository: { full_name: 'org/repo' } })).toBeNull();
  });

  it('pull_request aberto (não fechado) vira pull_request_opened, mesmo sem user/body/html_url', () => {
    const event = normalizeGithubEvent('pull_request', {
      repository: { full_name: 'org/repo' },
      action: 'opened',
      pull_request: { title: 'Fix #42' },
    });
    expect(event?.kind).toBe('pull_request_opened');
    expect(event?.authorName).toBe('GitHub');
    expect(event?.url).toBe('https://github.com/org/repo');
  });

  it('pull_request fechado sem merge vira pull_request_closed', () => {
    const event = normalizeGithubEvent('pull_request', {
      repository: { full_name: 'org/repo' },
      action: 'closed',
      pull_request: { title: 'Fix #42', merged: false },
    });
    expect(event?.kind).toBe('pull_request_closed');
  });

  it('push sem commits com mensagem retorna null', () => {
    expect(normalizeGithubEvent('push', { repository: { full_name: 'org/repo' }, commits: [] })).toBeNull();
  });
});

describe('normalizeGitlabEvent', () => {
  it('normaliza um push com commits, usando o último como autor/url', () => {
    const event = normalizeGitlabEvent({
      object_kind: 'push',
      project: { path_with_namespace: 'org/repo', web_url: 'https://gitlab.com/org/repo' },
      commits: [
        { message: 'primeiro commit', url: 'https://x/1', author: { name: 'Dev A' } },
        { message: 'fix #42', url: 'https://x/2', author: { name: 'Dev B' } },
      ],
    });
    expect(event?.kind).toBe('push');
    expect(event?.repo).toBe('org/repo');
    expect(event?.authorName).toBe('Dev B');
    expect(event?.url).toBe('https://x/2');
    expect(event?.searchableText).toEqual(['primeiro commit', 'fix #42']);
  });

  it('push sem commits com mensagem retorna null', () => {
    expect(
      normalizeGitlabEvent({
        object_kind: 'push',
        project: { path_with_namespace: 'org/repo' },
        commits: [],
      }),
    ).toBeNull();
  });

  it('merge_request mergeado', () => {
    const event = normalizeGitlabEvent({
      object_kind: 'merge_request',
      project: { path_with_namespace: 'org/repo', web_url: 'https://gitlab.com/org/repo' },
      object_attributes: { title: 'Fix #42', url: 'https://x', state: 'merged' },
      user: { name: 'Dev' },
    });
    expect(event?.kind).toBe('pull_request_merged');
    expect(event?.repo).toBe('org/repo');
  });

  it('merge_request fechado sem merge vira pull_request_closed, aberto vira pull_request_opened', () => {
    const base = {
      object_kind: 'merge_request' as const,
      project: { path_with_namespace: 'org/repo' },
      user: {},
    };
    expect(
      normalizeGitlabEvent({ ...base, object_attributes: { title: 'A', state: 'closed' } })?.kind,
    ).toBe('pull_request_closed');
    expect(
      normalizeGitlabEvent({ ...base, object_attributes: { title: 'A', state: 'opened' } })?.kind,
    ).toBe('pull_request_opened');
  });

  it('lança quando falta project.path_with_namespace', () => {
    expect(() => normalizeGitlabEvent({ object_kind: 'push', project: {} })).toThrow();
  });

  it('lança quando merge_request não tem object_attributes.title', () => {
    expect(() =>
      normalizeGitlabEvent({
        object_kind: 'merge_request',
        project: { path_with_namespace: 'org/repo' },
        object_attributes: {},
      }),
    ).toThrow();
  });

  it('retorna null para um tipo de evento sem handler (ex.: "issue")', () => {
    expect(normalizeGitlabEvent({ object_kind: 'issue', project: { path_with_namespace: 'org/repo' } })).toBeNull();
  });
});

describe('normalizeAzureDevOpsEvent', () => {
  it('normaliza um git.push', () => {
    const event = normalizeAzureDevOpsEvent({
      eventType: 'git.push',
      resource: { repository: { name: 'repo' }, commits: [{ comment: 'fix #42', url: 'https://x', author: { name: 'Dev' } }] },
    });
    expect(event?.kind).toBe('push');
  });

  it('push sem commits com mensagem retorna null', () => {
    expect(
      normalizeAzureDevOpsEvent({ eventType: 'git.push', resource: { repository: { name: 'repo' }, commits: [] } }),
    ).toBeNull();
  });

  it('usa repository.project.name quando repository.name está ausente', () => {
    const event = normalizeAzureDevOpsEvent({
      eventType: 'git.push',
      resource: { repository: { project: { name: 'proj' } }, commits: [{ comment: 'fix', url: 'https://x' }] },
    });
    expect(event?.repo).toBe('proj');
  });

  it('normaliza um pull request completado', () => {
    const event = normalizeAzureDevOpsEvent({
      eventType: 'git.pullrequest.merged',
      resource: { repository: { name: 'repo' }, title: 'Fix #42', status: 'completed', createdBy: { displayName: 'Dev' } },
    });
    expect(event?.kind).toBe('pull_request_merged');
  });

  it('pull request abandonado vira pull_request_closed, criado vira pull_request_opened', () => {
    const resourceBase = { repository: { name: 'repo' }, title: 'Fix #42' };
    expect(
      normalizeAzureDevOpsEvent({
        eventType: 'git.pullrequest.updated',
        resource: { ...resourceBase, status: 'abandoned' },
      })?.kind,
    ).toBe('pull_request_closed');
    expect(
      normalizeAzureDevOpsEvent({
        eventType: 'git.pullrequest.created',
        resource: { ...resourceBase, status: 'active' },
      })?.kind,
    ).toBe('pull_request_opened');
  });

  it('lança quando resource.title está ausente num evento de pull request', () => {
    expect(() =>
      normalizeAzureDevOpsEvent({ eventType: 'git.pullrequest.created', resource: { repository: { name: 'repo' } } }),
    ).toThrow();
  });

  it('lança quando falta resource por completo', () => {
    expect(() => normalizeAzureDevOpsEvent({ eventType: 'git.push' })).toThrow();
  });

  it('retorna null para um eventType sem handler (ex.: "build.complete")', () => {
    expect(normalizeAzureDevOpsEvent({ eventType: 'build.complete', resource: { repository: { name: 'repo' } } })).toBeNull();
  });
});

describe('mensagens de chat', () => {
  it('slackNotificationBlocks inclui título/corpo e um botão quando há url', () => {
    const blocks = slackNotificationBlocks({ title: 'Título', body: 'Corpo', url: 'https://x' });
    expect(JSON.stringify(blocks)).toContain('Título');
    expect(JSON.stringify(blocks)).toContain('actions');
  });

  it('teamsAdaptiveCard omite a ação quando não há url', () => {
    const card = teamsAdaptiveCard({ title: 'Título', body: 'Corpo', url: null });
    expect(JSON.stringify(card)).not.toContain('Action.OpenUrl');
  });

  it('teamsAdaptiveCard inclui a ação "Action.OpenUrl" quando há url', () => {
    const card = teamsAdaptiveCard({ title: 'Título', body: 'Corpo', url: 'https://x' });
    expect(JSON.stringify(card)).toContain('Action.OpenUrl');
  });

  it('slackNotificationBlocks omite o botão de ação quando não há url', () => {
    const blocks = slackNotificationBlocks({ title: 'Título', body: 'Corpo', url: null });
    expect(JSON.stringify(blocks)).not.toContain('actions');
  });
});

describe('eventos de calendário (Google/Microsoft)', () => {
  const input = {
    title: 'Entrega do módulo',
    description: 'Descrição do item',
    startDate: '2026-03-10',
    endDate: '2026-03-12',
    url: 'https://cubetrack.example.com/items/abc',
  };

  it('buildGoogleCalendarEventBody soma um dia ao fim (end.date exclusivo)', () => {
    const body = buildGoogleCalendarEventBody(input) as {
      start: { date: string };
      end: { date: string };
      summary: string;
    };
    expect(body.summary).toBe('Entrega do módulo');
    expect(body.start.date).toBe('2026-03-10');
    expect(body.end.date).toBe('2026-03-13');
  });

  it('buildMicrosoftCalendarEventBody marca isAllDay e soma um dia ao fim', () => {
    const body = buildMicrosoftCalendarEventBody(input) as {
      isAllDay: boolean;
      start: { dateTime: string };
      end: { dateTime: string };
    };
    expect(body.isAllDay).toBe(true);
    expect(body.start.dateTime).toBe('2026-03-10');
    expect(body.end.dateTime).toBe('2026-03-13');
  });
});

describe('isDoneLikeStatusLabel', () => {
  it('reconhece rótulos de "concluído" em pt-BR/en', () => {
    expect(isDoneLikeStatusLabel('Concluído')).toBe(true);
    expect(isDoneLikeStatusLabel('Done')).toBe(true);
    expect(isDoneLikeStatusLabel('Completed')).toBe(true);
    expect(isDoneLikeStatusLabel('Finalizado')).toBe(true);
  });

  it('não reconhece rótulos sem relação clara com "concluído" (heurística conservadora)', () => {
    expect(isDoneLikeStatusLabel('Em andamento')).toBe(false);
    expect(isDoneLikeStatusLabel('Bloqueado')).toBe(false);
    expect(isDoneLikeStatusLabel('A fazer')).toBe(false);
  });
});

describe('verifyGithubSignature', () => {
  const secret = 'segredo-do-webhook';
  const rawBody = JSON.stringify({ hello: 'world' });
  const validSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  it('aceita uma assinatura HMAC-SHA256 correta', () => {
    expect(verifyGithubSignature(secret, rawBody, validSignature)).toBe(true);
  });

  it('rejeita uma assinatura incorreta', () => {
    expect(verifyGithubSignature(secret, rawBody, 'sha256=0000')).toBe(false);
  });

  it('rejeita quando o cabeçalho está ausente ou em formato errado', () => {
    expect(verifyGithubSignature(secret, rawBody, undefined)).toBe(false);
    expect(verifyGithubSignature(secret, rawBody, validSignature.replace('sha256=', ''))).toBe(false);
  });
});

describe('verifySlackSignature', () => {
  const signingSecret = 'segredo-do-app-slack';
  const rawBody = 'command=/cubetrack&text=create';
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const base = `v0:${timestamp}:${rawBody}`;
  const validSignature = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`;

  it('aceita uma assinatura válida e recente', () => {
    expect(verifySlackSignature({ signingSecret, timestamp, rawBody, signatureHeader: validSignature })).toBe(true);
  });

  it('rejeita uma assinatura inválida', () => {
    expect(
      verifySlackSignature({ signingSecret, timestamp, rawBody, signatureHeader: 'v0=0000' }),
    ).toBe(false);
  });

  it('rejeita um timestamp com mais de 5 minutos (replay)', () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1_000) - 600);
    const staleBase = `v0:${staleTimestamp}:${rawBody}`;
    const staleSignature = `v0=${createHmac('sha256', signingSecret).update(staleBase).digest('hex')}`;
    expect(
      verifySlackSignature({ signingSecret, timestamp: staleTimestamp, rawBody, signatureHeader: staleSignature }),
    ).toBe(false);
  });
});

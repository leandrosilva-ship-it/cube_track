import { describe, expect, it } from 'vitest';

import { extractItemReferences, normalizeAzureDevOpsEvent, normalizeGithubEvent, normalizeGitlabEvent, slackNotificationBlocks, teamsAdaptiveCard } from './integrations.js';

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
});

describe('normalizeGitlabEvent', () => {
  it('normaliza um merge_request mergeado', () => {
    const event = normalizeGitlabEvent({
      object_kind: 'merge_request',
      project: { path_with_namespace: 'org/repo', web_url: 'https://gitlab.com/org/repo' },
      object_attributes: { title: 'Fix #42', url: 'https://x', state: 'merged' },
      user: { name: 'Dev' },
    });
    expect(event?.kind).toBe('pull_request_merged');
    expect(event?.repo).toBe('org/repo');
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

  it('normaliza um pull request completado', () => {
    const event = normalizeAzureDevOpsEvent({
      eventType: 'git.pullrequest.merged',
      resource: { repository: { name: 'repo' }, title: 'Fix #42', status: 'completed', createdBy: { displayName: 'Dev' } },
    });
    expect(event?.kind).toBe('pull_request_merged');
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
});

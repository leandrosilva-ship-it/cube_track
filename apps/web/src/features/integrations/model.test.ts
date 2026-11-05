import { describe, expect, it } from 'vitest';

import { buildDevWebhookUrl, buildSlackEventsUrl, categoryOf, isKnownProvider } from './model';

describe('categoryOf', () => {
  it('classifica cada provedor na categoria certa', () => {
    expect(categoryOf('google')).toBe('oauth');
    expect(categoryOf('microsoft')).toBe('oauth');
    expect(categoryOf('slack')).toBe('chat');
    expect(categoryOf('teams')).toBe('chat');
    expect(categoryOf('github')).toBe('dev');
    expect(categoryOf('gitlab')).toBe('dev');
    expect(categoryOf('azure_devops')).toBe('dev');
  });
});

describe('isKnownProvider', () => {
  it('reconhece só os provedores suportados', () => {
    expect(isKnownProvider('google')).toBe(true);
    expect(isKnownProvider('azure_devops')).toBe(true);
    expect(isKnownProvider('bitbucket')).toBe(false);
  });
});

describe('buildSlackEventsUrl / buildDevWebhookUrl', () => {
  it('monta a URL de eventos do Slack, removendo barra final da base', () => {
    expect(buildSlackEventsUrl('https://api.example.com', 'c1')).toBe(
      'https://api.example.com/v1/integrations/slack/c1/events',
    );
    expect(buildSlackEventsUrl('https://api.example.com/', 'c1')).toBe(
      'https://api.example.com/v1/integrations/slack/c1/events',
    );
  });

  it('monta a URL do webhook de entrada por provedor', () => {
    expect(buildDevWebhookUrl('https://api.example.com', 'github', 'c1')).toBe(
      'https://api.example.com/v1/integrations/github/c1/webhook',
    );
    expect(buildDevWebhookUrl('https://api.example.com', 'gitlab', 'c2')).toBe(
      'https://api.example.com/v1/integrations/gitlab/c2/webhook',
    );
    expect(buildDevWebhookUrl('https://api.example.com', 'azure_devops', 'c3')).toBe(
      'https://api.example.com/v1/integrations/azure_devops/c3/webhook',
    );
  });
});

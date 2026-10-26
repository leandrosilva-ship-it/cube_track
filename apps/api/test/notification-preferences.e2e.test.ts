import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { client, startApi, USERS, type ApiClient, type ApiServer } from './helpers.js';

interface NotificationPreference {
  id: string;
  channel: 'in_app' | 'email' | 'push';
  eventType: string;
  enabled: boolean;
  frequency: 'instant' | 'hourly' | 'daily' | 'never';
}

describe('Preferências de notificação do usuário (ADR 0051)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let other: string;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    other = await api.login(USERS.thiago);
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET começa vazio; PUT faz upsert por (canal, tipo de evento) sem duplicar', async () => {
    const empty = await api.get<{ data: NotificationPreference[] }>(
      '/v1/me/notification-preferences',
      {
        token: owner,
      },
    );
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);

    const created = await api.put<{ data: NotificationPreference[] }>(
      '/v1/me/notification-preferences',
      {
        token: owner,
        body: {
          preferences: [{ channel: 'email', eventType: '*', enabled: true, frequency: 'daily' }],
        },
      },
    );
    expect(created.status).toBe(200);
    expect(created.body.data).toHaveLength(1);
    expect(created.body.data[0]).toMatchObject({
      channel: 'email',
      eventType: '*',
      enabled: true,
      frequency: 'daily',
    });
    const firstId = created.body.data[0]?.id;

    const updated = await api.put<{ data: NotificationPreference[] }>(
      '/v1/me/notification-preferences',
      {
        token: owner,
        body: {
          preferences: [{ channel: 'email', eventType: '*', enabled: false, frequency: 'hourly' }],
        },
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data).toHaveLength(1);
    expect(updated.body.data[0]?.id).toBe(firstId);
    expect(updated.body.data[0]).toMatchObject({ enabled: false, frequency: 'hourly' });

    const list = await api.get<{ data: NotificationPreference[] }>(
      '/v1/me/notification-preferences',
      { token: owner },
    );
    expect(list.body.data).toHaveLength(1);
  });

  it('rejeita frequência `weekly` (fora do enum da API) e canal desconhecido', async () => {
    const weekly = await api.put('/v1/me/notification-preferences', {
      token: owner,
      body: {
        preferences: [{ channel: 'email', eventType: '*', enabled: true, frequency: 'weekly' }],
      },
    });
    expect(weekly.status).toBe(400);

    const unknownChannel = await api.put('/v1/me/notification-preferences', {
      token: owner,
      body: {
        preferences: [{ channel: 'sms', eventType: '*', enabled: true, frequency: 'instant' }],
      },
    });
    expect(unknownChannel.status).toBe(400);
  });

  it('isola preferências entre usuários', async () => {
    await api.put('/v1/me/notification-preferences', {
      token: other,
      body: {
        preferences: [
          { channel: 'email', eventType: 'approval', enabled: true, frequency: 'instant' },
        ],
      },
    });
    const ownerList = await api.get<{ data: NotificationPreference[] }>(
      '/v1/me/notification-preferences',
      { token: owner },
    );
    expect(ownerList.body.data.some((entry) => entry.eventType === 'approval')).toBe(false);

    const otherList = await api.get<{ data: NotificationPreference[] }>(
      '/v1/me/notification-preferences',
      { token: other },
    );
    expect(otherList.body.data.some((entry) => entry.eventType === 'approval')).toBe(true);
  });
});

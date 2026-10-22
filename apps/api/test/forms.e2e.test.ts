import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  client,
  demoIds,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
  type BoardDetailFixture,
} from './helpers.js';

interface FormDto {
  id: string;
  boardId: string;
  name: string;
  isPublic: boolean;
  requiresLogin: boolean;
  isActive: boolean;
  hasPublicLink: boolean;
}
interface FieldDto {
  id: string;
  formId: string;
  columnKey: string | null;
  label: string;
  fieldType: string;
  isRequired: boolean;
  position: string;
}
interface PublicDefinition {
  formId: string;
  boardId: string;
  requiresLogin: boolean;
  fields: { id: string; columnKey: string | null; fieldType: string; isRequired: boolean }[];
  captcha: { token: string; question: string } | null;
}

function solve(question: string): number {
  const match = /(\d+)\s*\+\s*(\d+)/.exec(question);
  const a = Number(match?.[1] ?? 0);
  const b = Number(match?.[2] ?? 0);
  return a + b;
}

describe('Formulários — CRUD autenticado, link público e envio', () => {
  let server: ApiServer;
  let api: ApiClient;
  let token: string;
  let boardId: string;
  let board: BoardDetailFixture;
  let statusLabelId: string;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    token = await api.login(USERS.fernanda);
    ({ boardId, board } = await demoIds(api, token));
    const statusColumn = board.columns.find((column) => column.key === 'c_status');
    statusLabelId = statusColumn?.labels[0]?.id ?? '';
    expect(statusLabelId).not.toBe('');
  });

  afterAll(async () => {
    await server.close();
  });

  let formId: string;
  let nameFieldId: string;
  let statusFieldId: string;

  it('cria formulário e campos (nativo + mapeado a coluna real)', async () => {
    const created = await api.post<FormDto>(`/v1/boards/${boardId}/forms`, {
      token,
      body: { name: 'Formulário de teste — intake', description: 'Criado pelo e2e' },
    });
    expect(created.status).toBe(201);
    expect(created.body.isActive).toBe(true);
    formId = created.body.id;

    const nameField = await api.post<FieldDto>(`/v1/forms/${formId}/fields`, {
      token,
      body: { label: 'Título da demanda', fieldType: 'text', isRequired: true },
    });
    expect(nameField.status).toBe(201);
    expect(nameField.body.fieldType).toBe('text');
    nameFieldId = nameField.body.id;

    const statusField = await api.post<FieldDto>(`/v1/forms/${formId}/fields`, {
      token,
      body: { columnKey: 'c_status', label: 'Status inicial', isRequired: true },
    });
    expect(statusField.status).toBe(201);
    // fieldType é derivado do tipo real da coluna, não do que (não) foi enviado.
    expect(statusField.body.fieldType).toBe('status');
    statusFieldId = statusField.body.id;

    const list = await api.get<{ data: FieldDto[] }>(`/v1/forms/${formId}/fields`, { token });
    expect(list.body.data.map((field) => field.id)).toEqual([nameFieldId, statusFieldId]);
  });

  it('rejeita campo mapeado a uma coluna vinculada (bound) a um campo nativo', async () => {
    const response = await api.post(`/v1/forms/${formId}/fields`, {
      token,
      body: { columnKey: 'c_inicio', label: 'Início' },
    });
    expect(response.status).toBe(422);
  });

  it('atualiza um campo e emite/revoga o link público', async () => {
    const updated = await api.patch<FieldDto>(`/v1/form-fields/${nameFieldId}`, {
      token,
      body: { label: 'Nome da solicitação' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.label).toBe('Nome da solicitação');

    const issued = await api.post<{ form: FormDto; token: string | null }>(
      `/v1/forms/${formId}/public-link`,
      { token, body: { isPublic: true } },
    );
    expect(issued.status).toBe(200);
    expect(issued.body.form.hasPublicLink).toBe(true);
    expect(issued.body.token).not.toBeNull();
  });

  let publicToken: string;

  it('a definição pública traz os campos e um desafio de captcha', async () => {
    const link = await api.post<{ token: string | null }>(`/v1/forms/${formId}/public-link`, {
      token,
      body: { isPublic: true },
    });
    publicToken = link.body.token ?? '';
    expect(publicToken).not.toBe('');

    const definition = await api.get<PublicDefinition>(`/v1/public/forms/${publicToken}`);
    expect(definition.status).toBe(200);
    expect(definition.body.boardId).toBe(boardId);
    expect(definition.body.requiresLogin).toBe(false);
    expect(definition.body.fields).toHaveLength(2);
    expect(definition.body.captcha).not.toBeNull();
  });

  it('envio público anônimo exige honeypot vazio e captcha correto', async () => {
    const definition = await api.get<PublicDefinition>(`/v1/public/forms/${publicToken}`);
    const challenge = definition.body.captcha;
    expect(challenge).not.toBeNull();

    const wrongCaptcha = await api.post(`/v1/public/forms/${publicToken}/submit`, {
      body: {
        answers: { [nameFieldId]: 'Item via formulário público', [statusFieldId]: { labelId: statusLabelId } },
        captcha: { token: challenge?.token ?? '', answer: -1 },
      },
    });
    expect(wrongCaptcha.status).toBe(422);

    const withHoneypot = await api.post(`/v1/public/forms/${publicToken}/submit`, {
      body: {
        answers: { [nameFieldId]: 'Item via formulário público', [statusFieldId]: { labelId: statusLabelId } },
        honeypot: 'sou um robô',
        captcha: { token: challenge?.token ?? '', answer: solve(challenge?.question ?? '') },
      },
    });
    expect(withHoneypot.status).toBe(422);

    const missingRequired = await api.post(`/v1/public/forms/${publicToken}/submit`, {
      body: {
        answers: { [nameFieldId]: 'Item via formulário público' },
        captcha: { token: challenge?.token ?? '', answer: solve(challenge?.question ?? '') },
      },
    });
    expect(missingRequired.status).toBe(400);

    const accepted = await api.post<{ itemId: string }>(`/v1/public/forms/${publicToken}/submit`, {
      body: {
        answers: { [nameFieldId]: 'Item via formulário público', [statusFieldId]: { labelId: statusLabelId } },
        captcha: { token: challenge?.token ?? '', answer: solve(challenge?.question ?? '') },
      },
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.itemId).toBeDefined();

    const createdItem = await api.get<{ name: string; values: Record<string, unknown> }>(
      `/v1/items/${accepted.body.itemId}`,
      { token },
    );
    expect(createdItem.body.name).toBe('Item via formulário público');
    await api.delete(`/v1/items/${accepted.body.itemId}`, { token });
  });

  it('preenchimento interno autenticado cria o item sem captcha', async () => {
    const response = await api.post<{ id: string; name: string }>(`/v1/forms/${formId}/submit`, {
      token,
      body: {
        answers: {
          [nameFieldId]: 'Item via preenchimento interno',
          [statusFieldId]: { labelId: statusLabelId },
        },
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.name).toBe('Item via preenchimento interno');
    await api.delete(`/v1/items/${response.body.id}`, { token });
  });

  it('remove um campo e, por fim, o formulário', async () => {
    const removed = await api.delete(`/v1/form-fields/${statusFieldId}`, { token });
    expect(removed.status).toBe(204);
    const list = await api.get<{ data: FieldDto[] }>(`/v1/forms/${formId}/fields`, { token });
    expect(list.body.data.map((field) => field.id)).toEqual([nameFieldId]);

    const deleted = await api.delete(`/v1/forms/${formId}`, { token });
    expect(deleted.status).toBe(204);
    const notFound = await api.get(`/v1/forms/${formId}`, { token });
    expect(notFound.status).toBe(404);
  });
});

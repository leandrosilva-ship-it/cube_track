import { describe, expect, it } from 'vitest';

import {
  allowsNameOverride,
  buildApplyBody,
  emptyApplyTemplateState,
  needsBoardPicker,
  needsWorkspacePicker,
} from './model';

describe('needsWorkspacePicker / needsBoardPicker / allowsNameOverride', () => {
  it('board e dashboard sempre exigem workspace; automation e form exigem board (e, antes, o workspace que o contém)', () => {
    const state = emptyApplyTemplateState();
    expect(needsWorkspacePicker('board', state)).toBe(true);
    expect(needsWorkspacePicker('dashboard', state)).toBe(true);
    expect(needsWorkspacePicker('automation', state)).toBe(true);
    expect(needsWorkspacePicker('form', state)).toBe(true);
    expect(needsBoardPicker('automation')).toBe(true);
    expect(needsBoardPicker('form')).toBe(true);
    expect(needsBoardPicker('board')).toBe(false);
  });

  it('workspace exige workspace só quando não é um novo workspace', () => {
    expect(needsWorkspacePicker('workspace', { ...emptyApplyTemplateState(), useNewWorkspace: false })).toBe(true);
    expect(needsWorkspacePicker('workspace', { ...emptyApplyTemplateState(), useNewWorkspace: true })).toBe(false);
  });

  it('só board e dashboard aceitam substituir o nome', () => {
    expect(allowsNameOverride('board')).toBe(true);
    expect(allowsNameOverride('dashboard')).toBe(true);
    expect(allowsNameOverride('automation')).toBe(false);
    expect(allowsNameOverride('workspace')).toBe(false);
    expect(allowsNameOverride('form')).toBe(false);
  });
});

describe('buildApplyBody', () => {
  it('board: exige workspaceId, nome é opcional', () => {
    expect(buildApplyBody('board', emptyApplyTemplateState())).toBeNull();
    expect(buildApplyBody('board', { ...emptyApplyTemplateState(), workspaceId: 'w1' })).toEqual({ workspaceId: 'w1' });
    expect(buildApplyBody('board', { ...emptyApplyTemplateState(), workspaceId: 'w1', name: ' Novo ' })).toEqual({
      workspaceId: 'w1',
      name: 'Novo',
    });
  });

  it('dashboard: mesma regra do board', () => {
    expect(buildApplyBody('dashboard', { ...emptyApplyTemplateState(), workspaceId: 'w1' })).toEqual({ workspaceId: 'w1' });
  });

  it('workspace: workspaceId existente OU newWorkspaceName, nunca os dois', () => {
    expect(buildApplyBody('workspace', { ...emptyApplyTemplateState(), workspaceId: 'w1' })).toEqual({ workspaceId: 'w1' });
    expect(buildApplyBody('workspace', emptyApplyTemplateState())).toBeNull();
    expect(
      buildApplyBody('workspace', { ...emptyApplyTemplateState(), useNewWorkspace: true, newWorkspaceName: 'Nova Org' }),
    ).toEqual({ newWorkspaceName: 'Nova Org' });
    expect(buildApplyBody('workspace', { ...emptyApplyTemplateState(), useNewWorkspace: true })).toBeNull();
  });

  it('automation: exige boardId', () => {
    expect(buildApplyBody('automation', emptyApplyTemplateState())).toBeNull();
    expect(buildApplyBody('automation', { ...emptyApplyTemplateState(), boardId: 'b1' })).toEqual({ boardId: 'b1' });
  });

  it('form: exige boardId, targetGroupId é opcional', () => {
    expect(buildApplyBody('form', { ...emptyApplyTemplateState(), boardId: 'b1' })).toEqual({ boardId: 'b1' });
    expect(buildApplyBody('form', { ...emptyApplyTemplateState(), boardId: 'b1', targetGroupId: 'g1' })).toEqual({
      boardId: 'b1',
      targetGroupId: 'g1',
    });
  });
});

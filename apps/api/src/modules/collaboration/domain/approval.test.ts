import { describe, expect, it } from 'vitest';

import { resolveApprovalStatus } from './approval.js';

describe('resolveApprovalStatus', () => {
  it('modo "all": pendente enquanto alguém não decidiu', () => {
    expect(resolveApprovalStatus('all', [null, null])).toBe('pending');
    expect(resolveApprovalStatus('all', ['approved', null])).toBe('pending');
  });

  it('modo "all": aprova só quando todos aprovam', () => {
    expect(resolveApprovalStatus('all', ['approved', 'approved'])).toBe('approved');
  });

  it('modo "all": uma rejeição já resolve, mesmo com pendentes', () => {
    expect(resolveApprovalStatus('all', ['rejected', null])).toBe('rejected');
    expect(resolveApprovalStatus('all', ['approved', 'rejected'])).toBe('rejected');
  });

  it('modo "any": a primeira aprovação já resolve', () => {
    expect(resolveApprovalStatus('any', ['approved', null])).toBe('approved');
    expect(resolveApprovalStatus('any', [null, 'rejected', 'approved'])).toBe('approved');
  });

  it('modo "any": só rejeita quando todos rejeitam', () => {
    expect(resolveApprovalStatus('any', ['rejected', null])).toBe('pending');
    expect(resolveApprovalStatus('any', ['rejected', 'rejected'])).toBe('rejected');
  });

  it('sem aprovadores fica pendente', () => {
    expect(resolveApprovalStatus('any', [])).toBe('pending');
  });
});

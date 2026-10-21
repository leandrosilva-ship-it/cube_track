import { describe, expect, it } from 'vitest';

import type { Member } from '@/lib/api/types';

import { filterMentionCandidates, mentionCandidates } from './mention-candidates';

const members: Member[] = [
  { userId: 'u1', name: 'Ana Ribeiro', email: 'ana@x.com', avatarUrl: null, kind: 'member', status: 'active', roleId: 'r1', jobTitle: null },
  { userId: 'u2', name: 'Carlos Lima', email: 'carlos@x.com', avatarUrl: null, kind: 'member', status: 'active', roleId: 'r1', jobTitle: null },
];

describe('mentionCandidates', () => {
  it('coloca "todos" primeiro, seguido dos membros', () => {
    const candidates = mentionCandidates(members, 'todos');
    expect(candidates[0]).toEqual({ kind: 'everyone', id: null, label: 'todos' });
    expect(candidates.slice(1).map((c) => c.label)).toEqual(['Ana Ribeiro', 'Carlos Lima']);
  });
});

describe('filterMentionCandidates', () => {
  const candidates = mentionCandidates(members, 'todos');

  it('sem busca retorna tudo (até o limite)', () => {
    expect(filterMentionCandidates(candidates, '')).toHaveLength(3);
  });

  it('filtra por nome (case-insensitive)', () => {
    expect(filterMentionCandidates(candidates, 'carlos').map((c) => c.label)).toEqual(['Carlos Lima']);
    expect(filterMentionCandidates(candidates, 'ANA').map((c) => c.label)).toEqual(['Ana Ribeiro']);
  });

  it('sem correspondência retorna vazio', () => {
    expect(filterMentionCandidates(candidates, 'zzz')).toEqual([]);
  });
});

import type { Member } from '@/lib/api/types';

export interface MentionCandidate {
  kind: 'user' | 'everyone';
  id: string | null;
  label: string;
  avatarUrl?: string | null;
}

/** Candidatos de @menção: "todos" (seguidores do board) seguido dos membros do tenant. */
export function mentionCandidates(
  members: readonly Member[],
  everyoneLabel: string,
): MentionCandidate[] {
  return [
    { kind: 'everyone', id: null, label: everyoneLabel },
    ...members.map((member) => ({
      kind: 'user' as const,
      id: member.userId,
      label: member.name,
      avatarUrl: member.avatarUrl,
    })),
  ];
}

export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const needle = query.trim().toLowerCase();
  const matches =
    needle === '' ? candidates : candidates.filter((candidate) => candidate.label.toLowerCase().includes(needle));
  return matches.slice(0, 8);
}

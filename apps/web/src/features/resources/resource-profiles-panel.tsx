'use client';

import { Badge, Button, Dialog, Field, IconButton, Input, Modal, Select, Skeleton, toast } from '@cube-track/ui';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useMembers } from '../shell/hooks';
import type { ResourceProfile } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useCreateSkill,
  useDeleteSkill,
  useResourceProfiles,
  useSetUserSkills,
  useSkills,
  useUpsertResourceProfile,
  useUserSkills,
  type UpsertResourceProfileInput,
} from './hooks';
import { formatHours } from './model';

function SkillsCatalog() {
  const t = useTranslations('capacity');
  const skills = useSkills();
  const createSkill = useCreateSkill();
  const deleteSkill = useDeleteSkill();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState('');

  const add = async () => {
    if (name.trim() === '') return;
    try {
      await createSkill.mutateAsync({ name: name.trim() });
      setName('');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold">{t('skills.title')}</h3>
      <div className="mb-3 flex flex-wrap gap-2">
        {(skills.data ?? []).map((skill) => (
          <Badge key={skill.id} tone="neutral" className="flex items-center gap-1">
            {skill.name}
            <button
              type="button"
              aria-label={t('skills.remove', { name: skill.name })}
              onClick={() => {
                deleteSkill.mutate(skill.id);
              }}
              className="hover:text-danger"
            >
              <Trash2 className="size-3" aria-hidden="true" />
            </button>
          </Badge>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
        className="flex max-w-sm gap-2"
      >
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder={t('skills.newPlaceholder')}
          aria-label={t('skills.newPlaceholder')}
        />
        <Button type="submit" size="sm" loading={createSkill.isPending}>
          <Plus aria-hidden="true" />
          {t('skills.add')}
        </Button>
      </form>
    </section>
  );
}

function ProfileEditDialog({ profile, onClose }: { profile: ResourceProfile; onClose: () => void }) {
  const t = useTranslations('capacity');
  const tc = useTranslations('common');
  const members = useMembers();
  const skills = useSkills();
  const userSkills = useUserSkills(profile.userId);
  const upsert = useUpsertResourceProfile();
  const setSkills = useSetUserSkills();
  const errorMessage = useErrorMessage();

  const [draft, setDraft] = useState<UpsertResourceProfileInput>({
    jobTitle: profile.jobTitle,
    department: profile.department,
    managerId: profile.managerId,
    capacityHoursPerWeek: profile.capacityHoursPerWeek,
    costRateHour: profile.costRateHour,
    billRateHour: profile.billRateHour,
    location: profile.location,
  });
  const [levels, setLevels] = useState<Map<string, number>>(
    () => new Map((userSkills.data ?? []).map((entry) => [entry.skillId, entry.level])),
  );

  const toggleSkill = (skillId: string) => {
    setLevels((prev) => {
      const next = new Map(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.set(skillId, 3);
      return next;
    });
  };

  const save = async () => {
    try {
      await upsert.mutateAsync({ userId: profile.userId, input: draft });
      await setSkills.mutateAsync({
        userId: profile.userId,
        entries: [...levels.entries()].map(([skillId, level]) => ({ skillId, level })),
      });
      toast.success(t('profiles.saved'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const managerOptions = (members.data ?? [])
    .filter((member) => member.userId !== profile.userId)
    .map((member) => ({ value: member.userId, label: member.name }));

  return (
    <Modal
      title={profile.userName}
      description={t('profiles.editDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => void save()} loading={upsert.isPending || setSkills.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('profiles.jobTitle')}>
          <Input
            value={draft.jobTitle ?? ''}
            onChange={(event) => {
              setDraft((prev) => ({ ...prev, jobTitle: event.target.value === '' ? null : event.target.value }));
            }}
          />
        </Field>
        <Field label={t('profiles.department')}>
          <Input
            value={draft.department ?? ''}
            onChange={(event) => {
              setDraft((prev) => ({ ...prev, department: event.target.value === '' ? null : event.target.value }));
            }}
          />
        </Field>
        <Field label={t('profiles.manager')}>
          <Select
            value={draft.managerId ?? ''}
            onValueChange={(value) => {
              setDraft((prev) => ({ ...prev, managerId: value === '' ? null : value }));
            }}
            options={[{ value: '', label: t('profiles.noManager') }, ...managerOptions]}
          />
        </Field>
        <Field label={t('profiles.capacityHoursPerWeek')}>
          <Input
            type="number"
            min={0}
            max={80}
            value={draft.capacityHoursPerWeek ?? profile.capacityHoursPerWeek}
            onChange={(event) => {
              setDraft((prev) => ({ ...prev, capacityHoursPerWeek: event.target.value }));
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('profiles.costRateHour')}>
            <Input
              type="number"
              min={0}
              value={draft.costRateHour ?? ''}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, costRateHour: event.target.value === '' ? null : event.target.value }));
              }}
            />
          </Field>
          <Field label={t('profiles.billRateHour')}>
            <Input
              type="number"
              min={0}
              value={draft.billRateHour ?? ''}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, billRateHour: event.target.value === '' ? null : event.target.value }));
              }}
            />
          </Field>
        </div>
        <Field label={t('profiles.location')}>
          <Input
            value={draft.location ?? ''}
            onChange={(event) => {
              setDraft((prev) => ({ ...prev, location: event.target.value === '' ? null : event.target.value }));
            }}
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('profiles.skillsTitle')}</legend>
          <div className="flex flex-wrap gap-2">
            {(skills.data ?? []).map((skill) => {
              const active = levels.has(skill.id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => {
                    toggleSkill(skill.id);
                  }}
                  aria-pressed={active}
                  className={
                    active
                      ? 'rounded-full border border-primary bg-primary-soft px-3 py-1 text-xs font-medium text-primary'
                      : 'rounded-full border border-border px-3 py-1 text-xs text-fg-muted hover:bg-surface-hover'
                  }
                >
                  {skill.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

/** Administração de perfis de recurso e skills (ADR 0052): cargo, custo, jornada e competências. */
export function ResourceProfilesPanel() {
  const t = useTranslations('capacity');
  const profiles = useResourceProfiles();
  const [editing, setEditing] = useState<ResourceProfile | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <SkillsCatalog />
      <section className="rounded-xl border border-border bg-surface">
        <h3 className="border-b border-border p-4 text-sm font-semibold">{t('profiles.title')}</h3>
        {profiles.data === undefined ? (
          <div className="p-4">
            <Skeleton className="h-32" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-xs text-fg-muted">
                <th className="px-4 py-2 text-start">{t('profiles.columns.name')}</th>
                <th className="px-4 py-2 text-start">{t('profiles.columns.jobTitle')}</th>
                <th className="px-4 py-2 text-start">{t('profiles.columns.manager')}</th>
                <th className="px-4 py-2 text-start">{t('profiles.columns.capacity')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {profiles.data.map((profile) => (
                <tr key={profile.userId} className="border-b border-border last:border-0">
                  <td className="flex items-center gap-2 px-4 py-2">
                    <Users className="size-4 text-fg-muted" aria-hidden="true" />
                    {profile.userName}
                  </td>
                  <td className="px-4 py-2 text-fg-muted">{profile.jobTitle ?? '—'}</td>
                  <td className="px-4 py-2 text-fg-muted">{profile.managerName ?? '—'}</td>
                  <td className="px-4 py-2 text-fg-muted">{formatHours(profile.capacityHoursPerWeek)}h</td>
                  <td className="px-4 py-2 text-end">
                    <IconButton
                      label={t('profiles.edit')}
                      icon={<Pencil aria-hidden="true" />}
                      size="icon-sm"
                      onClick={() => {
                        setEditing(profile);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        {editing !== null ? (
          <ProfileEditDialog
            profile={editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

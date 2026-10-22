/**
 * Numeração EAP/WBS (Estrutura Analítica do Projeto): `1`, `1.1`, `1.2`, `2`, `2.1`… — um nível por
 * grupo (seção do board) e, dentro dele, a hierarquia item → subitem, na ordem de `position`
 * (fractional index, ADR 0008). Função pura: o Gantt recalcula no cliente a cada mudança de
 * grupo/item/posição, sem gravar a numeração no banco (ela é derivada, não uma fonte de verdade).
 */

export interface WbsGroup {
  id: string;
  position: string;
}

export interface WbsItem {
  id: string;
  groupId: string;
  parentItemId: string | null;
  position: string;
}

function byPosition(a: { position: string }, b: { position: string }): number {
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return 0;
}

export function computeWbsNumbers(
  groups: readonly WbsGroup[],
  items: readonly WbsItem[],
): Map<string, string> {
  const result = new Map<string, string>();
  const topLevelByGroup = new Map<string, WbsItem[]>();
  const childrenByParent = new Map<string, WbsItem[]>();
  for (const item of items) {
    if (item.parentItemId === null) {
      topLevelByGroup.set(item.groupId, [...(topLevelByGroup.get(item.groupId) ?? []), item]);
    } else {
      childrenByParent.set(item.parentItemId, [
        ...(childrenByParent.get(item.parentItemId) ?? []),
        item,
      ]);
    }
  }

  const assignChildren = (parentId: string, parentCode: string): void => {
    const children = [...(childrenByParent.get(parentId) ?? [])].sort(byPosition);
    children.forEach((child, index) => {
      const code = `${parentCode}.${String(index + 1)}`;
      result.set(child.id, code);
      assignChildren(child.id, code);
    });
  };

  [...groups].sort(byPosition).forEach((group, groupIndex) => {
    const topLevel = [...(topLevelByGroup.get(group.id) ?? [])].sort(byPosition);
    topLevel.forEach((item, itemIndex) => {
      const code = `${String(groupIndex + 1)}.${String(itemIndex + 1)}`;
      result.set(item.id, code);
      assignChildren(item.id, code);
    });
  });

  return result;
}

import { createHash } from 'node:crypto';

import { initialPositions, newId } from '@cube-track/shared';
import { eq } from 'drizzle-orm';

import { appendAuditLog } from '../audit.js';
import {
  activityLogs,
  attachments,
  attachmentVersions,
  baselines,
  baselineSnapshots,
  boards,
  checklistItems,
  checklists,
  columnDefinitions,
  contracts,
  dependencies,
  dropdownOptions,
  follows,
  groups,
  idSequences,
  invoices,
  items,
  measurements,
  mentions,
  milestones,
  notifications,
  reactions,
  replies,
  serviceCatalogItems,
  serviceOrderItems,
  serviceOrders,
  statusLabels,
  updates,
} from '../schema/index.js';
import {
  CATALOG,
  CHECKLIST_TEMPLATES,
  DEMANDS,
  DEMO_USERS,
  FRENTES,
  ORGAOS,
  REPLY_TEMPLATES,
  SIM_NAO,
  STATUS_LABELS,
  SUBITEM_TEMPLATES,
  TIPOS,
  UPDATE_TEMPLATES,
  type DemandGroup,
  type DemandSpec,
  type StatusLabel,
} from './data.js';
import { at, addDays, maxDate } from './random.js';
import { richText, SEED_REFERENCE_DATE, userId, type SeedContext } from './context.js';

export interface PmspBoard {
  boardId: string;
  groupIds: Record<DemandGroup, string>;
  contractId: string;
  itemIds: Map<string, string>;
  columnIds: Record<string, string>;
  statusLabelIds: Record<string, string>;
  frenteLabelIds: Record<string, string>;
  tipoLabelIds: Record<string, string>;
  orgaoOptionIds: Record<string, string>;
  demandDates: Map<string, DemandDates>;
}

export interface DemandDates {
  requestedAt: string;
  issuedAt: string | null;
  startDate: string | null;
  plannedEnd: string | null;
  replannedEnd: string | null;
  actualEnd: string | null;
  billedAt: string | null;
  status: StatusLabel;
  serviceOrderNumber: string | null;
}

const UST_UNIT_PRICE = '148.5000';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function pickOrThrow<T>(record: Record<string, T>, key: string): T {
  const value = record[key];
  if (value === undefined) throw new Error(`Chave ausente: ${key}`);
  return value;
}

/** Board PMSP: contrato, catálogo, colunas do caso de referência e 60 demandas. */
export async function seedPmspBoard(
  ctx: SeedContext,
  refs: { programId: string; portfolioId: string; folderId: string },
): Promise<PmspBoard> {
  const { tx, tenantId, rng } = ctx;
  const createdBy = userId(ctx, 'fernanda');

  // Contrato e catálogo de serviços (Código Edital) -----------------------------------------
  const contractId = newId();
  await tx.insert(contracts).values({
    id: contractId,
    tenantId,
    workspaceId: ctx.workspaceId,
    number: '012/2025',
    title: 'Contrato nº 012/2025 – Prefeitura de São Paulo (PMSP)',
    clientName: 'Prefeitura do Município de São Paulo',
    clientDocument: '46.395.000/0001-39',
    object:
      'Prestação de serviços técnicos especializados de transformação digital, redesenho de serviços e sustentação, medidos em Unidades de Serviço Técnico (UST).',
    seiProcess: '6011.2025/0004521-7',
    biddingReference: 'Pregão Eletrônico nº 045/2024',
    startDate: '2025-06-02',
    endDate: '2027-06-01',
    ustUnitPrice: UST_UNIT_PRICE,
    ustContracted: '12000.0000',
    totalValue: '1782000.0000',
    status: 'active',
    managerId: userId(ctx, 'carlos'),
    createdBy,
  });
  const catalogIds: Record<string, { id: string; ust: string }> = {};
  await tx.insert(serviceCatalogItems).values(
    CATALOG.map((entry, index) => {
      const id = newId();
      catalogIds[entry.code] = { id, ust: entry.ust };
      return {
        id,
        tenantId,
        contractId,
        code: entry.code,
        name: entry.name,
        category: entry.category,
        defaultUst: entry.ust,
        sortOrder: index,
        createdBy,
      };
    }),
  );

  // Board e grupos --------------------------------------------------------------------------
  const boardId = newId();
  await tx.insert(boards).values({
    id: boardId,
    tenantId,
    workspaceId: ctx.workspaceId,
    folderId: refs.folderId,
    portfolioId: refs.portfolioId,
    programId: refs.programId,
    kind: 'project',
    name: 'PMSP',
    description: 'Demandas do contrato 012/2025 com a Prefeitura de São Paulo, medidas em UST.',
    ownerId: userId(ctx, 'fernanda'),
    terminology: { singular: 'demanda', plural: 'demandas' },
    status: 'active',
    startDate: '2025-06-02',
    endDate: '2027-06-01',
    workCalendarId: ctx.calendarId,
    contractId,
    position: initialPositions(1)[0] ?? 'a0',
    createdBy,
  });

  const groupPositions = initialPositions(3);
  const groupIds: Record<DemandGroup, string> = {
    analise: newId(),
    andamento: newId(),
    concluida: newId(),
  };
  await tx.insert(groups).values([
    {
      id: groupIds.analise,
      tenantId,
      boardId,
      name: 'Demandas em Análise',
      color: '#fdab3d',
      position: groupPositions[0] ?? 'a0',
      createdBy,
    },
    {
      id: groupIds.andamento,
      tenantId,
      boardId,
      name: 'Demandas em Andamento',
      color: '#579bfc',
      position: groupPositions[1] ?? 'a1',
      createdBy,
    },
    {
      id: groupIds.concluida,
      tenantId,
      boardId,
      name: 'Concluídas',
      color: '#00c875',
      position: groupPositions[2] ?? 'a2',
      createdBy,
    },
  ]);

  // Colunas -----------------------------------------------------------------------------------
  const columnSpecs = [
    {
      key: 'c_id',
      type: 'auto_id',
      title: 'ID',
      settings: { mask: '{YYYY}-{SEQ:4}', resetPeriod: 'yearly', applyToSubitems: false },
      width: 110,
    },
    { key: 'c_orgao', type: 'dropdown', title: 'Órgão', settings: { multiple: false }, width: 140 },
    {
      key: 'c_os_numero',
      type: 'text',
      title: 'Nº Ordem de Serviço',
      binding: 'service_order.number',
      width: 150,
    },
    {
      key: 'c_sei',
      type: 'text',
      title: 'Processo SEI',
      binding: 'service_order.sei_process',
      width: 190,
    },
    {
      key: 'c_emissao_os',
      type: 'date',
      title: 'Data Emissão OS',
      binding: 'service_order.issued_at',
      width: 140,
    },
    {
      key: 'c_inicio',
      type: 'date',
      title: 'Data de início',
      binding: 'item.planned_start_date',
      width: 130,
    },
    { key: 'c_frente', type: 'status', title: 'Frente de Trabalho', width: 170 },
    { key: 'c_responsaveis', type: 'people', title: 'Responsáveis', width: 150 },
    {
      key: 'c_codigo_edital',
      type: 'text',
      title: 'Código Edital',
      binding: 'service_order.catalog_codes',
      width: 130,
    },
    { key: 'c_os_solicitada', type: 'status', title: 'OS solicitada', width: 120 },
    { key: 'c_os_emitida', type: 'status', title: 'OS emitida', width: 120 },
    { key: 'c_tipo', type: 'status', title: 'Tipo de tarefa', width: 160 },
    {
      key: 'c_ust',
      type: 'number',
      title: 'Qtde de UST',
      binding: 'service_order.total_ust',
      settings: { unit: 'UST', unitPosition: 'suffix', decimals: 2, aggregate: 'sum' },
      width: 120,
    },
    {
      key: 'c_termino_planejado',
      type: 'date',
      title: 'Término Planejado',
      binding: 'item.planned_end_date',
      width: 150,
    },
    {
      key: 'c_termino_replanejado',
      type: 'date',
      title: 'Término Replanejado',
      binding: 'item.replanned_end_date',
      width: 160,
    },
    {
      key: 'c_termino_realizado',
      type: 'date',
      title: 'Término Realizado',
      binding: 'item.actual_end_date',
      width: 150,
    },
    {
      key: 'c_faturamento',
      type: 'date',
      title: 'Data de faturamento',
      binding: 'service_order.billed_at',
      width: 160,
    },
    { key: 'c_status', type: 'status', title: 'Status', width: 150 },
  ] as const;
  const columnPositions = initialPositions(columnSpecs.length);
  const columnIds: Record<string, string> = {};
  await tx.insert(columnDefinitions).values(
    columnSpecs.map((spec, index) => {
      const id = newId();
      columnIds[spec.key] = id;
      return {
        id,
        tenantId,
        boardId,
        key: spec.key,
        type: spec.type,
        title: spec.title,
        settings: 'settings' in spec ? { ...spec.settings } : {},
        binding: 'binding' in spec ? spec.binding : null,
        position: columnPositions[index] ?? `a${index}`,
        width: spec.width,
        isRequired: spec.key === 'c_orgao' || spec.key === 'c_frente',
        permissions:
          spec.key === 'c_ust' || spec.key === 'c_faturamento'
            ? { editors: { userIds: [userId(ctx, 'carlos'), userId(ctx, 'ana')] } }
            : {},
        createdBy,
      };
    }),
  );

  const insertLabels = async (
    columnKey: string,
    labels: readonly { label: string; color: string; category?: string }[],
  ): Promise<Record<string, string>> => {
    const positions = initialPositions(labels.length);
    const ids: Record<string, string> = {};
    await tx.insert(statusLabels).values(
      labels.map((entry, index) => {
        const id = newId();
        ids[entry.label] = id;
        return {
          id,
          tenantId,
          columnId: pickOrThrow(columnIds, columnKey),
          label: entry.label,
          color: entry.color,
          category: (entry.category ?? 'in_progress') as
            | 'not_started'
            | 'in_progress'
            | 'done'
            | 'stuck',
          position: positions[index] ?? `a${index}`,
          isDefault: index === 0,
          createdBy,
        };
      }),
    );
    return ids;
  };
  const statusLabelIds = await insertLabels('c_status', STATUS_LABELS);
  const frenteLabelIds = await insertLabels('c_frente', FRENTES);
  const tipoLabelIds = await insertLabels('c_tipo', TIPOS);
  const solicitadaIds = await insertLabels('c_os_solicitada', SIM_NAO);
  const emitidaIds = await insertLabels('c_os_emitida', SIM_NAO);
  // Término realizado obrigatório quando o Status passa a "Concluído" (obrigatoriedade condicional).
  await tx
    .update(columnDefinitions)
    .set({
      requiredWhen: {
        op: 'and',
        conditions: [
          { field: 'c_status', operator: 'is', value: statusLabelIds['Concluído'] ?? '' },
        ],
      },
    })
    .where(eq(columnDefinitions.id, columnIds.c_termino_realizado ?? ''));
  await tx
    .update(boards)
    .set({ settings: { statusColumnKey: 'c_status' } })
    .where(eq(boards.id, boardId));

  const orgaoOptionIds: Record<string, string> = {};
  const orgaoPositions = initialPositions(ORGAOS.length);
  await tx.insert(dropdownOptions).values(
    ORGAOS.map((label, index) => {
      const id = newId();
      orgaoOptionIds[label] = id;
      return {
        id,
        tenantId,
        columnId: pickOrThrow(columnIds, 'c_orgao'),
        label,
        position: orgaoPositions[index] ?? `a${index}`,
        createdBy,
      };
    }),
  );

  // Contador do ID automático começa em 900 (base histórica migrada do Monday).
  await tx.insert(idSequences).values({
    tenantId,
    scope: `column:${pickOrThrow(columnIds, 'c_id')}`,
    periodKey: SEED_REFERENCE_DATE.slice(0, 4),
    currentValue: 900,
    createdBy,
  });

  // Datas, OS e itens ------------------------------------------------------------------------
  const byGroup: Record<DemandGroup, DemandSpec[]> = { analise: [], andamento: [], concluida: [] };
  for (const demand of DEMANDS) byGroup[demand.group].push(demand);

  const demandDates = new Map<string, DemandDates>();
  const osCounters: Record<string, number> = {};
  const nextOsNumber = (issuedAt: string) => {
    const year = issuedAt.slice(0, 4);
    osCounters[year] = (osCounters[year] ?? 0) + 1;
    return `${String(osCounters[year]).padStart(3, '0')}/${year}`;
  };
  const seiNumber = (date: string) => `6011.${date.slice(0, 4)}/${rng.digits(7)}-${rng.digits(1)}`;

  byGroup.concluida.forEach((demand, index) => {
    const issuedAt = addDays('2025-07-01', index * 14 + rng.int(0, 5));
    const startDate = addDays(issuedAt, rng.int(1, 5));
    const plannedEnd = addDays(startDate, rng.int(20, 45));
    const replannedEnd = rng.chance(0.4) ? addDays(plannedEnd, rng.int(7, 21)) : null;
    const actualEnd = maxDate(
      addDays(replannedEnd ?? plannedEnd, rng.int(-5, 5)),
      addDays(startDate, 5),
    );
    const billCandidate = addDays(actualEnd, rng.int(10, 30));
    const billedAt = billCandidate < SEED_REFERENCE_DATE && rng.chance(0.85) ? billCandidate : null;
    demandDates.set(demand.name, {
      requestedAt: addDays(issuedAt, -rng.int(5, 15)),
      issuedAt,
      startDate,
      plannedEnd,
      replannedEnd,
      actualEnd,
      billedAt,
      status: 'Concluído',
      serviceOrderNumber: nextOsNumber(issuedAt),
    });
  });
  const progressStatuses: StatusLabel[] = [
    'Em andamento',
    'Em andamento',
    'Em andamento',
    'Aguardando cliente',
    'Em homologação',
    'Parado',
  ];
  byGroup.andamento.forEach((demand, index) => {
    const issuedAt = addDays('2026-04-15', index * 6 + rng.int(0, 4));
    const startDate = addDays(issuedAt, rng.int(1, 5));
    const plannedEnd = addDays(startDate, rng.int(30, 75));
    demandDates.set(demand.name, {
      requestedAt: addDays(issuedAt, -rng.int(5, 15)),
      issuedAt,
      startDate,
      plannedEnd,
      replannedEnd: rng.chance(0.4) ? addDays(plannedEnd, rng.int(10, 30)) : null,
      actualEnd: null,
      billedAt: null,
      status: rng.pick(progressStatuses),
      serviceOrderNumber: nextOsNumber(issuedAt),
    });
  });
  byGroup.analise.forEach((demand, index) => {
    const requestedAt = addDays('2026-08-20', index * 3 + rng.int(0, 2));
    demandDates.set(demand.name, {
      requestedAt,
      issuedAt: null,
      startDate: null,
      plannedEnd: null,
      replannedEnd: null,
      actualEnd: null,
      billedAt: null,
      status: 'Não iniciado',
      serviceOrderNumber: index % 3 === 2 ? null : nextOsNumber(requestedAt),
    });
  });

  const itemIds = new Map<string, string>();
  const serviceOrderIds = new Map<string, string>();
  const groupOrder: DemandGroup[] = ['analise', 'andamento', 'concluida'];
  for (const group of groupOrder) {
    const demands = byGroup[group];
    const positions = initialPositions(demands.length);
    for (const [index, demand] of demands.entries()) {
      const dates = demandDates.get(demand.name);
      if (dates === undefined) throw new Error(`Datas ausentes: ${demand.name}`);
      const itemId = newId();
      itemIds.set(demand.name, itemId);
      const hasOs = dates.serviceOrderNumber !== null;
      const issued = dates.issuedAt !== null;
      const progress =
        group === 'concluida' ? '100.00' : group === 'andamento' ? `${rng.int(10, 85)}.00` : '0.00';
      await tx.insert(items).values({
        id: itemId,
        tenantId,
        boardId,
        groupId: groupIds[group],
        name: demand.name,
        position: positions[index] ?? `a${index}`,
        values: {
          c_orgao: { optionIds: [pickOrThrow(orgaoOptionIds, demand.orgao)] },
          c_frente: { labelId: pickOrThrow(frenteLabelIds, demand.frente) },
          c_responsaveis: { personIds: demand.owners.map((key) => userId(ctx, key)), teamIds: [] },
          c_os_solicitada: { labelId: pickOrThrow(solicitadaIds, hasOs ? 'Sim' : 'Não') },
          c_os_emitida: { labelId: pickOrThrow(emitidaIds, issued ? 'Sim' : 'Não') },
          c_tipo: { labelId: pickOrThrow(tipoLabelIds, demand.tipo) },
          c_status: { labelId: pickOrThrow(statusLabelIds, dates.status) },
        },
        plannedStartDate: dates.startDate,
        plannedEndDate: dates.plannedEnd,
        replannedEndDate: dates.replannedEnd,
        actualStartDate: dates.startDate !== null && group !== 'analise' ? dates.startDate : null,
        actualEndDate: dates.actualEnd,
        progress,
        completedAt: dates.actualEnd === null ? null : at(dates.actualEnd, '17:30'),
        createdBy,
        updatedBy: createdBy,
        createdAt: at(dates.requestedAt, '09:15'),
        updatedAt: at(dates.actualEnd ?? dates.issuedAt ?? dates.requestedAt, '18:00'),
      });

      if (hasOs && dates.serviceOrderNumber !== null) {
        const serviceOrderId = newId();
        serviceOrderIds.set(demand.name, serviceOrderId);
        const lines = demand.services.map(([code, quantity]) => {
          const catalog = pickOrThrow(catalogIds, code);
          const ustTotal = (Number(catalog.ust) * quantity).toFixed(4);
          return {
            catalogItemId: catalog.id,
            quantity: quantity.toFixed(4),
            ustUnit: catalog.ust,
            ustTotal,
          };
        });
        const totalUst = lines.reduce((sum, line) => sum + Number(line.ustTotal), 0).toFixed(4);
        await tx.insert(serviceOrders).values({
          id: serviceOrderId,
          tenantId,
          contractId,
          boardId,
          itemId,
          number: dates.serviceOrderNumber,
          seiProcess: seiNumber(dates.requestedAt),
          description: demand.name,
          status:
            group === 'concluida'
              ? dates.billedAt === null
                ? 'accepted'
                : 'invoiced'
              : group === 'andamento'
                ? 'in_progress'
                : 'requested',
          requestedAt: dates.requestedAt,
          issuedAt: dates.issuedAt,
          startDate: dates.startDate,
          plannedEndDate: dates.plannedEnd,
          deliveredAt: dates.actualEnd,
          acceptedAt: dates.actualEnd === null ? null : addDays(dates.actualEnd, 3),
          billedAt: dates.billedAt,
          totalUst,
          requesterName: `Fiscal do contrato – ${demand.orgao}`,
          createdBy,
        });
        await tx
          .insert(serviceOrderItems)
          .values(lines.map((line) => ({ ...line, tenantId, serviceOrderId, createdBy })));
      }

      await tx.insert(activityLogs).values({
        tenantId,
        boardId,
        itemId,
        actorId: createdBy,
        action: 'item.created',
        entityType: 'item',
        entityId: itemId,
        newValue: { name: demand.name, group },
        createdAt: at(dates.requestedAt, '09:15'),
        createdBy,
      });
      if (dates.actualEnd !== null) {
        await tx.insert(activityLogs).values({
          tenantId,
          boardId,
          itemId,
          actorId: userId(ctx, demand.owners[0] ?? 'fernanda'),
          action: 'item.value_changed',
          entityType: 'item',
          entityId: itemId,
          columnKey: 'c_status',
          oldValue: { label: 'Em homologação' },
          newValue: { label: 'Concluído' },
          createdAt: at(dates.actualEnd, '17:30'),
          createdBy,
        });
      }
    }
  }

  await seedSubitemsAndChecklists(ctx, {
    boardId,
    groupIds,
    itemIds,
    statusLabelIds,
    frenteLabelIds,
    demandDates,
  });
  await seedCollaboration(ctx, { boardId, itemIds, demandDates });
  await seedSchedule(ctx, { boardId, itemIds, demandDates });
  await seedBilling(ctx, { contractId, serviceOrderIds, demandDates });

  await appendAuditLog(tx, {
    tenantId,
    actorId: createdBy,
    action: 'board.created',
    entityType: 'board',
    entityId: boardId,
    after: { name: 'PMSP', kind: 'project', contractId },
    metadata: { source: 'seed' },
  });
  await appendAuditLog(tx, {
    tenantId,
    actorId: userId(ctx, 'carlos'),
    action: 'contract.created',
    entityType: 'contract',
    entityId: contractId,
    after: { number: '012/2025', ustContracted: '12000.0000', ustUnitPrice: UST_UNIT_PRICE },
    metadata: { source: 'seed' },
  });

  await tx.insert(follows).values([
    {
      tenantId,
      userId: userId(ctx, 'fernanda'),
      entityType: 'board',
      entityId: boardId,
      createdBy,
    },
    { tenantId, userId: userId(ctx, 'carlos'), entityType: 'board', entityId: boardId, createdBy },
    {
      tenantId,
      userId: userId(ctx, 'patricia'),
      entityType: 'item',
      entityId: pickOrThrow(Object.fromEntries(itemIds), 'SMIT - SEI – Redesenho Integração SEI'),
      createdBy,
    },
  ]);

  return {
    boardId,
    groupIds,
    contractId,
    itemIds,
    columnIds,
    statusLabelIds,
    frenteLabelIds,
    tipoLabelIds,
    orgaoOptionIds,
    demandDates,
  };
}

interface ItemRefs {
  boardId: string;
  itemIds: Map<string, string>;
  demandDates: Map<string, DemandDates>;
}

function itemIdOf(refs: ItemRefs, name: string): string {
  const id = refs.itemIds.get(name);
  if (id === undefined) throw new Error(`Item de seed desconhecido: ${name}`);
  return id;
}

function datesOf(refs: ItemRefs, name: string): DemandDates {
  const dates = refs.demandDates.get(name);
  if (dates === undefined) throw new Error(`Datas de seed desconhecidas: ${name}`);
  return dates;
}

async function seedSubitemsAndChecklists(
  ctx: SeedContext,
  refs: ItemRefs & {
    groupIds: Record<DemandGroup, string>;
    statusLabelIds: Record<string, string>;
    frenteLabelIds: Record<string, string>;
  },
): Promise<void> {
  const { tx, tenantId } = ctx;
  const createdBy = userId(ctx, 'fernanda');
  const parents = [
    'SMIT - SEI – Redesenho Integração SEI',
    'COHAB - SIGRC - Transferência de titularidade do imóvel',
    'OGM - Portal - Aba OGM',
  ];
  for (const parentName of parents) {
    const parentId = itemIdOf(refs, parentName);
    const dates = datesOf(refs, parentName);
    const demand = DEMANDS.find((entry) => entry.name === parentName);
    const start = dates.startDate ?? SEED_REFERENCE_DATE;
    const positions = initialPositions(SUBITEM_TEMPLATES.length);
    const subStatuses: StatusLabel[] = ['Concluído', 'Em andamento', 'Não iniciado'];
    await tx.insert(items).values(
      SUBITEM_TEMPLATES.map((name, index) => ({
        tenantId,
        boardId: refs.boardId,
        groupId: refs.groupIds.andamento,
        parentItemId: parentId,
        name,
        position: positions[index] ?? `a${index}`,
        values: {
          c_status: {
            labelId: pickOrThrow(refs.statusLabelIds, subStatuses[index] ?? 'Não iniciado'),
          },
          c_responsaveis: {
            personIds: [
              userId(ctx, demand?.owners[index % (demand.owners.length || 1)] ?? 'fernanda'),
            ],
            teamIds: [],
          },
        },
        plannedStartDate: addDays(start, index * 10),
        plannedEndDate: addDays(start, index * 10 + 9),
        actualStartDate: index < 2 ? addDays(start, index * 10) : null,
        actualEndDate: index === 0 ? addDays(start, 9) : null,
        progress: index === 0 ? '100.00' : index === 1 ? '50.00' : '0.00',
        createdBy,
      })),
    );
  }

  const checklistTargets: { name: string; template: 0 | 1; done: number }[] = [
    { name: 'SMIT - SEI – Redesenho Integração SEI', template: 0, done: 2 },
    { name: 'OGM - Portal - Aba OGM', template: 0, done: 3 },
    {
      name: 'SMPED - Formulário - Inscrição no programa Bolsa Acessibilidade',
      template: 0,
      done: 1,
    },
    { name: 'COHAB - Aplicativo - Agendamento de vistorias', template: 0, done: 0 },
    { name: 'SMIT - SEI – Integração com protocolo digital', template: 1, done: 1 },
    { name: 'COHAB - SIGRC - Renegociação de dívidas de mutuários', template: 1, done: 2 },
    { name: 'OGM - Portal - Página de transparência de recomendações', template: 1, done: 0 },
  ];
  for (const target of checklistTargets) {
    const template = CHECKLIST_TEMPLATES[target.template];
    const checklistId = newId();
    await tx.insert(checklists).values({
      id: checklistId,
      tenantId,
      itemId: itemIdOf(refs, target.name),
      title: template.title,
      position: initialPositions(1)[0] ?? 'a0',
      createdBy,
    });
    const positions = initialPositions(template.items.length);
    await tx.insert(checklistItems).values(
      template.items.map((content, index) => ({
        tenantId,
        checklistId,
        content,
        isDone: index < target.done,
        doneAt: index < target.done ? at(addDays(SEED_REFERENCE_DATE, -10 + index), '15:00') : null,
        doneBy: index < target.done ? createdBy : null,
        position: positions[index] ?? `a${index}`,
        createdBy,
      })),
    );
  }
}

async function seedCollaboration(ctx: SeedContext, refs: ItemRefs): Promise<void> {
  const { tx, tenantId, rng } = ctx;
  const guestId = userId(ctx, 'patricia');
  const guestName = DEMO_USERS.find((user) => user.key === 'patricia')?.name ?? 'Convidado';
  const userName = (key: string) => DEMO_USERS.find((user) => user.key === key)?.name ?? key;

  for (const demand of DEMANDS) {
    const itemId = itemIdOf(refs, demand.name);
    const dates = datesOf(refs, demand.name);
    const templates = UPDATE_TEMPLATES[demand.group];
    const count = rng.int(1, Math.min(3, templates.length));
    const ownerKey = demand.owners[0] ?? 'fernanda';
    const baseDate = dates.issuedAt ?? dates.requestedAt;
    for (let index = 0; index < count; index += 1) {
      const template = templates[index] ?? templates[0];
      const authorKey = index === 0 ? 'fernanda' : ownerKey;
      const authorId = userId(ctx, authorKey);
      const parts: Parameters<typeof richText>[0] = [];
      const mentioned: { type: 'user'; id: string }[] = [];
      for (const [chunkIndex, chunk] of template.split(/(\{owner\}|\{guest\})/).entries()) {
        if (chunk === '{owner}') {
          parts.push({ mention: { id: userId(ctx, ownerKey), label: userName(ownerKey) } });
          mentioned.push({ type: 'user', id: userId(ctx, ownerKey) });
        } else if (chunk === '{guest}') {
          parts.push({ mention: { id: guestId, label: guestName } });
          mentioned.push({ type: 'user', id: guestId });
        } else if (chunk.length > 0 || chunkIndex === 0) {
          parts.push({ text: chunk });
        }
      }
      const body = richText(parts.filter((part) => !('text' in part) || part.text.length > 0));
      const createdAt = at(
        addDays(baseDate, index * rng.int(3, 9)),
        `1${rng.int(0, 7)}:${rng.int(10, 59)}`,
      );
      const updateId = newId();
      await tx.insert(updates).values({
        id: updateId,
        tenantId,
        boardId: refs.boardId,
        itemId,
        authorId,
        body: body.doc,
        bodyText: body.text,
        isPinned: index === 0 && demand.group === 'andamento' && rng.chance(0.2),
        createdAt,
        updatedAt: createdAt,
        createdBy: authorId,
      });
      for (const mention of mentioned) {
        await tx.insert(mentions).values({
          tenantId,
          sourceType: 'update',
          sourceId: updateId,
          itemId,
          targetType: mention.type,
          targetId: mention.id,
          createdAt,
          createdBy: authorId,
        });
        if (mention.id !== authorId) {
          await tx.insert(notifications).values({
            tenantId,
            userId: mention.id,
            type: 'mention',
            title: `${userName(authorKey)} mencionou você em "${demand.name}"`,
            body: body.text.slice(0, 280),
            actorId: authorId,
            boardId: refs.boardId,
            itemId,
            entityType: 'update',
            entityId: updateId,
            readAt:
              createdAt.toISOString().slice(0, 10) < addDays(SEED_REFERENCE_DATE, -14)
                ? at(addDays(createdAt.toISOString().slice(0, 10), 1))
                : null,
            createdAt,
            createdBy: authorId,
          });
        }
      }
      if (rng.chance(0.35)) {
        const replyAuthor =
          demand.group === 'analise' ? guestId : userId(ctx, rng.pick(demand.owners));
        const reply = richText([{ text: rng.pick(REPLY_TEMPLATES) }]);
        const replyAt = new Date(createdAt.getTime() + rng.int(1, 48) * 3_600_000);
        await tx.insert(replies).values({
          tenantId,
          updateId,
          authorId: replyAuthor,
          body: reply.doc,
          bodyText: reply.text,
          createdAt: replyAt,
          updatedAt: replyAt,
          createdBy: replyAuthor,
        });
      }
      if (rng.chance(0.4)) {
        await tx.insert(reactions).values({
          tenantId,
          targetType: 'update',
          targetId: updateId,
          userId: userId(ctx, rng.pick(['carlos', 'ana', 'juliana', 'rafael'])),
          emoji: rng.pick(['👍', '🎉', '👀', '✅']),
          createdBy: authorId,
        });
      }
      if (demand.group === 'concluida' && index === 0) {
        const attachmentId = newId();
        const fileName = `Termo de recebimento - ${dates.serviceOrderNumber?.replace('/', '-') ?? 'sem-OS'}.pdf`;
        await tx.insert(attachments).values({
          id: attachmentId,
          tenantId,
          boardId: refs.boardId,
          itemId,
          updateId,
          fileName,
          createdBy: authorId,
        });
        await tx.insert(attachmentVersions).values({
          tenantId,
          attachmentId,
          version: 1,
          storageKey: `tenants/${tenantId}/boards/${refs.boardId}/items/${itemId}/${attachmentId}/v1.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: rng.int(80_000, 900_000),
          checksumSha256: sha256(`${attachmentId}:v1`),
          scanStatus: 'clean',
          createdBy: authorId,
        });
      }
    }
  }
}

async function seedSchedule(ctx: SeedContext, refs: ItemRefs): Promise<void> {
  const { tx, tenantId } = ctx;
  const createdBy = userId(ctx, 'fernanda');
  const links: [string, string, 'FS' | 'SS' | 'FF' | 'SF', number][] = [
    [
      'SMIT - Mapeamento - Redesenho do processo de compras',
      'SMIT - SIGRC - Parametrização de SLA por tipo de demanda',
      'FS',
      0,
    ],
    [
      'COHAB - SIGRC - Transferência de titularidade do imóvel',
      'COHAB - Portal - Área do mutuário',
      'FS',
      2,
    ],
    [
      'OGM - SIGRC - Módulo de recomendações de auditoria',
      'OGM - BI - Indicadores de integridade das secretarias',
      'SS',
      5,
    ],
    [
      'SMPED - Mapeamento - Jornada do Atende+ (transporte especial)',
      'SMPED - Aplicativo - Carteira digital da pessoa com deficiência',
      'FS',
      0,
    ],
    [
      'SMIT - Aplicativo - Login com gov.br',
      'SMIT - Portal - Catálogo de serviços digitais',
      'FF',
      0,
    ],
  ];
  await tx.insert(dependencies).values(
    links.map(([from, to, type, lagDays]) => ({
      tenantId,
      boardId: refs.boardId,
      predecessorId: itemIdOf(refs, from),
      successorId: itemIdOf(refs, to),
      type,
      lagDays,
      createdBy,
    })),
  );

  const baselineId = newId();
  await tx.insert(baselines).values({
    id: baselineId,
    tenantId,
    boardId: refs.boardId,
    name: 'Baseline aprovada – Plano 2026',
    description: 'Linha de base aprovada com a SMIT na reunião de governança de maio/2026.',
    capturedAt: at('2026-05-04', '11:00'),
    isPrimary: true,
    createdBy,
  });
  const snapshotRows = DEMANDS.filter((demand) => demand.group !== 'analise').map((demand) => {
    const dates = datesOf(refs, demand.name);
    return {
      tenantId,
      baselineId,
      itemId: itemIdOf(refs, demand.name),
      startDate: dates.startDate,
      endDate: dates.plannedEnd,
      progress: demand.group === 'concluida' ? '100.00' : '0.00',
      data: { status: dates.status },
      createdBy,
    };
  });
  await tx.insert(baselineSnapshots).values(snapshotRows);

  const ogmItem = itemIdOf(refs, 'OGM - Portal - Aba OGM');
  await tx.insert(milestones).values([
    {
      tenantId,
      boardId: refs.boardId,
      itemId: ogmItem,
      name: 'Go-live da Aba OGM no Portal',
      dueDate: datesOf(refs, 'OGM - Portal - Aba OGM').plannedEnd ?? '2026-11-27',
      status: 'pending',
      createdBy,
    },
    {
      tenantId,
      boardId: refs.boardId,
      name: 'Encerramento do 1º ano de contrato',
      dueDate: '2026-06-01',
      status: 'achieved',
      achievedAt: at('2026-06-01', '18:00'),
      createdBy,
    },
  ]);
}

async function seedBilling(
  ctx: SeedContext,
  refs: {
    contractId: string;
    serviceOrderIds: Map<string, string>;
    demandDates: Map<string, DemandDates>;
  },
): Promise<void> {
  const { tx, tenantId } = ctx;
  const approver = userId(ctx, 'carlos');
  const byMonth = new Map<string, { ust: number }>();
  for (const demand of DEMANDS) {
    const dates = refs.demandDates.get(demand.name);
    if (dates?.billedAt === null || dates?.billedAt === undefined) continue;
    const month = dates.billedAt.slice(0, 7);
    const ust = demand.services.reduce(
      (sum, [code, quantity]) =>
        sum + Number(CATALOG.find((entry) => entry.code === code)?.ust ?? 0) * quantity,
      0,
    );
    byMonth.set(month, { ust: (byMonth.get(month)?.ust ?? 0) + ust });
  }
  let invoiceNumber = 100;
  for (const [month, { ust }] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const periodStart = `${month}-01`;
    const periodEnd = addDays(addDays(periodStart, 32).slice(0, 8) + '01', -1);
    const glosa = invoiceNumber === 102 ? 6 : 0;
    const approved = ust - glosa;
    const amount = (approved * Number(UST_UNIT_PRICE)).toFixed(4);
    const measurementId = newId();
    await tx.insert(measurements).values({
      id: measurementId,
      tenantId,
      contractId: refs.contractId,
      periodStart,
      periodEnd,
      measuredUst: ust.toFixed(4),
      glosaUst: glosa.toFixed(4),
      approvedUst: approved.toFixed(4),
      amount,
      status: 'approved',
      approvedBy: approver,
      approvedAt: at(addDays(periodEnd, 5), '16:00'),
      notes:
        glosa > 0 ? 'Glosa de 6 UST por atraso na entrega da documentação (cláusula 9.3).' : null,
      createdBy: approver,
    });
    const issueDate = addDays(periodEnd, 8);
    const dueDate = addDays(issueDate, 30);
    invoiceNumber += 1;
    await tx.insert(invoices).values({
      tenantId,
      contractId: refs.contractId,
      measurementId,
      number: `NFS-e ${invoiceNumber}`,
      issueDate,
      dueDate,
      amount,
      status: dueDate < SEED_REFERENCE_DATE ? 'paid' : 'issued',
      paidAt: dueDate < SEED_REFERENCE_DATE ? addDays(dueDate, -2) : null,
      createdBy: approver,
    });
  }
}

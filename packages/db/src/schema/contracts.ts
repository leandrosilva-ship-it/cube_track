import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { contractStatus, invoiceStatus, measurementStatus, serviceOrderStatus } from './_enums.js';
import { deletedAt, MONEY, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { boards, items, workspaces } from './structure.js';

/**
 * Módulo opcional Contratos/OS/UST (ADR 0017). Entidades relacionais fortes; expostas nos boards
 * como colunas vinculadas (`service_order.*`).
 */
export const contracts = tenantTable(
  'contracts',
  {
    workspaceId: uuid('workspace_id').notNull(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    clientName: text('client_name').notNull(),
    clientDocument: text('client_document'),
    object: text('object'),
    seiProcess: text('sei_process'),
    biddingReference: text('bidding_reference'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    ustUnitPrice: numeric('ust_unit_price', MONEY).notNull(),
    ustContracted: numeric('ust_contracted', MONEY).notNull(),
    totalValue: numeric('total_value', MONEY).notNull(),
    status: contractStatus('status').notNull().default('active'),
    managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('contracts', t.tenantId, t.workspaceId, workspaces),
    uniqueIndex('contracts_tenant_number_key')
      .on(t.tenantId, t.number)
      .where(sql`${t.deletedAt} is null`),
    check('contracts_dates', sql`${t.endDate} >= ${t.startDate}`),
    check(
      'contracts_values',
      sql`${t.ustUnitPrice} >= 0 and ${t.ustContracted} >= 0 and ${t.totalValue} >= 0`,
    ),
  ],
);

/** Catálogo de serviços do edital (Código Edital) com UST padrão por unidade. */
export const serviceCatalogItems = tenantTable(
  'service_catalog_items',
  {
    contractId: uuid('contract_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category'),
    defaultUst: numeric('default_ust', MONEY).notNull(),
    unit: text('unit').notNull().default('serviço'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    tenantFk('service_catalog_items', t.tenantId, t.contractId, contracts),
    uniqueIndex('service_catalog_items_contract_code_key').on(t.contractId, t.code),
    check('service_catalog_items_ust', sql`${t.defaultUst} >= 0`),
  ],
);

/** Ordem de Serviço (OS) vinculada a uma demanda (item do board). */
export const serviceOrders = tenantTable(
  'service_orders',
  {
    contractId: uuid('contract_id').notNull(),
    boardId: uuid('board_id'),
    itemId: uuid('item_id'),
    number: text('number').notNull(),
    seiProcess: text('sei_process'),
    description: text('description'),
    status: serviceOrderStatus('status').notNull().default('draft'),
    requestedAt: date('requested_at'),
    issuedAt: date('issued_at'),
    startDate: date('start_date'),
    plannedEndDate: date('planned_end_date'),
    deliveredAt: date('delivered_at'),
    acceptedAt: date('accepted_at'),
    billedAt: date('billed_at'),
    totalUst: numeric('total_ust', MONEY).notNull().default('0'),
    requesterName: text('requester_name'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('service_orders', t.tenantId, t.contractId, contracts),
    tenantFk('service_orders', t.tenantId, t.boardId, boards, 'set null'),
    tenantFk('service_orders', t.tenantId, t.itemId, items, 'set null'),
    uniqueIndex('service_orders_contract_number_key')
      .on(t.contractId, t.number)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('service_orders_item_key')
      .on(t.itemId)
      .where(sql`${t.itemId} is not null and ${t.deletedAt} is null`),
    index('service_orders_contract_status_idx').on(t.contractId, t.status),
    check('service_orders_ust', sql`${t.totalUst} >= 0`),
    check(
      'service_orders_dates',
      sql`${t.issuedAt} is null or ${t.requestedAt} is null or ${t.issuedAt} >= ${t.requestedAt}`,
    ),
  ],
);

/** Linha da OS: serviço do catálogo × quantidade → UST. */
export const serviceOrderItems = tenantTable(
  'service_order_items',
  {
    serviceOrderId: uuid('service_order_id').notNull(),
    catalogItemId: uuid('catalog_item_id').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull().default('1'),
    ustUnit: numeric('ust_unit', MONEY).notNull(),
    ustTotal: numeric('ust_total', MONEY).notNull(),
    description: text('description'),
  },
  (t) => [
    tenantFk('service_order_items', t.tenantId, t.serviceOrderId, serviceOrders),
    tenantFk('service_order_items', t.tenantId, t.catalogItemId, serviceCatalogItems, 'restrict'),
    index('service_order_items_order_idx').on(t.serviceOrderId),
    check('service_order_items_quantity', sql`${t.quantity} > 0`),
    check('service_order_items_total', sql`${t.ustTotal} = round(${t.quantity} * ${t.ustUnit}, 4)`),
  ],
);

/** Medição (período) com UST medida, glosada e aprovada. */
export const measurements = tenantTable(
  'measurements',
  {
    contractId: uuid('contract_id').notNull(),
    serviceOrderId: uuid('service_order_id'),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    measuredUst: numeric('measured_ust', MONEY).notNull(),
    glosaUst: numeric('glosa_ust', MONEY).notNull().default('0'),
    approvedUst: numeric('approved_ust', MONEY),
    amount: numeric('amount', MONEY),
    status: measurementStatus('status').notNull().default('draft'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => [
    tenantFk('measurements', t.tenantId, t.contractId, contracts),
    tenantFk('measurements', t.tenantId, t.serviceOrderId, serviceOrders, 'set null'),
    index('measurements_contract_period_idx').on(t.contractId, t.periodStart),
    check('measurements_dates', sql`${t.periodEnd} >= ${t.periodStart}`),
    check('measurements_glosa', sql`${t.glosaUst} >= 0 and ${t.glosaUst} <= ${t.measuredUst}`),
  ],
);

/** Fatura/nota fiscal emitida a partir de uma medição. */
export const invoices = tenantTable(
  'invoices',
  {
    contractId: uuid('contract_id').notNull(),
    measurementId: uuid('measurement_id'),
    number: text('number').notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date'),
    amount: numeric('amount', MONEY).notNull(),
    status: invoiceStatus('status').notNull().default('draft'),
    paidAt: date('paid_at'),
    nfeKey: text('nfe_key'),
  },
  (t) => [
    tenantFk('invoices', t.tenantId, t.contractId, contracts),
    tenantFk('invoices', t.tenantId, t.measurementId, measurements, 'set null'),
    uniqueIndex('invoices_contract_number_key').on(t.contractId, t.number),
    check('invoices_amount', sql`${t.amount} >= 0`),
    check('invoices_nfe_key', sql`${t.nfeKey} is null or ${t.nfeKey} ~ '^[0-9]{44}$'`),
  ],
);

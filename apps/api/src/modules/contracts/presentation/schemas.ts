import { CONTRACT_ALERT_TYPES } from '@cube-track/shared';
import { z } from 'zod';

const contractStatusEnum = z.enum(['draft', 'active', 'suspended', 'closed']);
const serviceOrderStatusEnum = z.enum([
  'draft',
  'requested',
  'issued',
  'in_progress',
  'delivered',
  'accepted',
  'measured',
  'invoiced',
  'cancelled',
]);
const measurementStatusEnum = z.enum(['draft', 'submitted', 'approved', 'rejected']);
const invoiceStatusEnum = z.enum(['draft', 'issued', 'paid', 'cancelled']);
const alertSeverityEnum = z.enum(['warning', 'critical']);
const alertTypeEnum = z.enum(CONTRACT_ALERT_TYPES);

const ust = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Quantidade de UST inválida.');
const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Valor inválido.');
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD).');

export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const ContractParams = z.object({ id: z.uuid() });
export const CatalogItemParams = z.object({ id: z.uuid() });
export const BoardParams = z.object({ boardId: z.uuid() });
export const ItemParams = z.object({ itemId: z.uuid() });
export const ServiceOrderParams = z.object({ id: z.uuid() });
export const ServiceOrderItemParams = z.object({ id: z.uuid() });
export const MeasurementParams = z.object({ id: z.uuid() });
export const InvoiceParams = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------------- contratos ---

export const ContractAlertSchema = z.object({
  type: alertTypeEnum,
  severity: alertSeverityEnum,
  message: z.string(),
});

export const ContractBalanceSchema = z.object({
  ustContracted: z.number(),
  ustConsumed: z.number(),
  ustBalance: z.number(),
  percentConsumed: z.number(),
});

export const StalledOrderSchema = z.object({
  serviceOrderId: z.uuid(),
  number: z.string(),
  alert: ContractAlertSchema,
});

export const ContractSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  number: z.string(),
  title: z.string(),
  clientName: z.string(),
  clientDocument: z.string().nullable(),
  object: z.string().nullable(),
  seiProcess: z.string().nullable(),
  biddingReference: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  ustUnitPrice: money,
  ustContracted: ust,
  totalValue: money,
  status: contractStatusEnum,
  managerId: z.uuid().nullable(),
  notes: z.string().nullable(),
  balance: ContractBalanceSchema,
  alerts: z.array(ContractAlertSchema),
  stalledOrders: z.array(StalledOrderSchema),
});

export const ContractSummarySchema = ContractSchema.omit({ balance: true, alerts: true, stalledOrders: true }).extend({
  balance: ContractBalanceSchema,
});

export const CreateContractBody = z
  .object({
    number: z.string().min(1).max(100),
    title: z.string().min(1).max(300),
    clientName: z.string().min(1).max(300),
    clientDocument: z.string().max(32).nullable().optional(),
    object: z.string().max(4_000).nullable().optional(),
    seiProcess: z.string().max(100).nullable().optional(),
    biddingReference: z.string().max(200).nullable().optional(),
    startDate: dateString,
    endDate: dateString,
    ustUnitPrice: money,
    ustContracted: ust,
    totalValue: money,
    status: contractStatusEnum.optional(),
    managerId: z.uuid().nullable().optional(),
    notes: z.string().max(4_000).nullable().optional(),
  })
  .strict();
export const UpdateContractBody = CreateContractBody.partial();

// ------------------------------------------------------------------------------------ catálogo ---

export const CatalogItemSchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  defaultUst: ust,
  unit: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export const CreateCatalogItemBody = z
  .object({
    code: z.string().min(1).max(50),
    name: z.string().min(1).max(300),
    description: z.string().max(4_000).nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    defaultUst: ust,
    unit: z.string().min(1).max(50).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();
export const UpdateCatalogItemBody = CreateCatalogItemBody.omit({ code: true }).partial();

// --------------------------------------------------------------------------- ordens de serviço ---

export const ServiceOrderItemSchema = z.object({
  id: z.uuid(),
  serviceOrderId: z.uuid(),
  catalogItemId: z.uuid(),
  catalogItemCode: z.string(),
  catalogItemName: z.string(),
  quantity: z.string(),
  ustUnit: ust,
  ustTotal: ust,
  description: z.string().nullable(),
  ustOverrideReason: z.string().nullable(),
});

export const ServiceOrderSchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  boardId: z.uuid().nullable(),
  itemId: z.uuid().nullable(),
  number: z.string(),
  seiProcess: z.string().nullable(),
  description: z.string().nullable(),
  status: serviceOrderStatusEnum,
  requestedAt: z.string().nullable(),
  issuedAt: z.string().nullable(),
  startDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  billedAt: z.string().nullable(),
  totalUst: ust,
  requesterName: z.string().nullable(),
  items: z.array(ServiceOrderItemSchema),
});

export const CreateServiceOrderBody = z
  .object({
    number: z.string().min(1).max(100),
    seiProcess: z.string().max(100).nullable().optional(),
    description: z.string().max(4_000).nullable().optional(),
    requesterName: z.string().max(200).nullable().optional(),
  })
  .strict();

export const UpdateServiceOrderBody = z
  .object({
    description: z.string().max(4_000).nullable().optional(),
    seiProcess: z.string().max(100).nullable().optional(),
    requesterName: z.string().max(200).nullable().optional(),
    startDate: dateString.nullable().optional(),
    plannedEndDate: dateString.nullable().optional(),
  })
  .strict();

export const TransitionServiceOrderBody = z
  .object({ to: serviceOrderStatusEnum })
  .strict();

export const CreateServiceOrderItemBody = z
  .object({
    catalogItemId: z.uuid(),
    quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Quantidade inválida.'),
    ustUnit: ust.optional(),
    ustOverrideReason: z.string().trim().max(2_000).optional(),
    description: z.string().max(2_000).nullable().optional(),
  })
  .strict();

export const UpdateServiceOrderItemBody = z
  .object({
    quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Quantidade inválida.').optional(),
    ustUnit: ust.optional(),
    ustOverrideReason: z.string().trim().max(2_000).optional(),
    description: z.string().max(2_000).nullable().optional(),
  })
  .strict();

// ------------------------------------------------------------------------------------ medição ---

export const MeasurementSchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
  measuredUst: ust,
  glosaUst: ust,
  approvedUst: ust.nullable(),
  amount: money.nullable(),
  status: measurementStatusEnum,
  approvedBy: z.uuid().nullable(),
  approvedAt: z.string().nullable(),
  notes: z.string().nullable(),
});

export const GenerateMeasurementBody = z
  .object({ periodStart: dateString, periodEnd: dateString })
  .strict();

export const UpdateMeasurementBody = z
  .object({ glosaUst: ust.optional(), notes: z.string().max(4_000).nullable().optional() })
  .strict();

export const DecideMeasurementBody = z
  .object({ status: z.enum(['approved', 'rejected']), notes: z.string().max(4_000).nullable().optional() })
  .strict();

// ------------------------------------------------------------------------------------- fatura ---

export const InvoiceSchema = z.object({
  id: z.uuid(),
  contractId: z.uuid(),
  measurementId: z.uuid().nullable(),
  number: z.string(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  amount: money,
  status: invoiceStatusEnum,
  paidAt: z.string().nullable(),
  nfeKey: z.string().nullable(),
});

export const CreateInvoiceBody = z
  .object({
    number: z.string().min(1).max(100),
    dueDate: dateString.nullable().optional(),
    nfeKey: z
      .string()
      .regex(/^\d{44}$/, 'Chave de NF-e deve ter 44 dígitos.')
      .nullable()
      .optional(),
  })
  .strict();

export const UpdateInvoiceBody = z
  .object({
    dueDate: dateString.nullable().optional(),
    nfeKey: z
      .string()
      .regex(/^\d{44}$/, 'Chave de NF-e deve ter 44 dígitos.')
      .nullable()
      .optional(),
  })
  .strict();

export const TransitionInvoiceBody = z.object({ to: invoiceStatusEnum }).strict();

import { Module } from '@nestjs/common';

import { CatalogService } from './application/catalog.service.js';
import { ContractsService } from './application/contracts.service.js';
import { InvoicesService } from './application/invoices.service.js';
import { MeasurementsService } from './application/measurements.service.js';
import { ServiceOrderItemsService } from './application/service-order-items.service.js';
import { ServiceOrdersService } from './application/service-orders.service.js';
import { BillingController } from './presentation/billing.controller.js';
import { ContractsController } from './presentation/contracts.controller.js';
import { ServiceOrdersController } from './presentation/service-orders.controller.js';

/**
 * Contratos, Ordens de Serviço e UST (ADR 0054) — módulo opcional por workspace (`enabledModules`,
 * ADR 0017): contratos/catálogo/OS/medição/fatura, saldo de UST sempre calculado ao vivo
 * (`ContractsService.toDto`, nunca armazenado) e alertas diários (worker, `contracts.ts` processor).
 */
@Module({
  controllers: [ContractsController, ServiceOrdersController, BillingController],
  providers: [ContractsService, CatalogService, ServiceOrdersService, ServiceOrderItemsService, MeasurementsService, InvoicesService],
  exports: [ContractsService],
})
export class ContractsModule {}

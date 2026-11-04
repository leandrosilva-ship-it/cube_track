import { Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { ItemSchema } from '../../work/presentation/schemas.js';
import { AiAssistantService } from '../application/ai-assistant.service.js';
import { AiContentService } from '../application/ai-content.service.js';
import { AiItemCreationService } from '../application/ai-item-creation.service.js';
import { AiPredictionsService } from '../application/ai-predictions.service.js';
import * as S from './schemas.js';

/**
 * Funcionalidades de IA por board/item (ADR 0055): assistente, criação de item por texto, resumos,
 * descrição e previsões. Todas exigem `ai.use` no workspace do board/item, o módulo opcional `ai`
 * ativo no workspace e a IA configurada/habilitada no tenant (`ai_not_configured` quando não está).
 */
@Controller()
export class AiController {
  constructor(
    private readonly assistant: AiAssistantService,
    private readonly itemCreation: AiItemCreationService,
    private readonly content: AiContentService,
    private readonly predictions: AiPredictionsService,
  ) {}

  @Post('boards/:boardId/ai/assistant')
  @Audited({ action: 'ai.assistant.ask', entityType: 'board' })
  @Endpoint({
    summary: 'Perguntar ao assistente de IA sobre os dados do board',
    description:
      'Requer `ai.use`. O assistente só usa ferramentas que chamam os services reais com a ' +
      'permissão de quem pergunta — nunca retorna dado que o usuário não possa ver.',
    tags: ['ai'],
    status: 200,
    params: S.BoardParams,
    body: S.AskAssistantBody,
    response: S.AssistantResponseSchema,
  })
  ask(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.AskAssistantBody>,
  ) {
    return this.assistant.ask(user, params.boardId, body.question);
  }

  @Post('boards/:boardId/ai/create-item')
  @Audited({ action: 'ai.item.create_from_text', entityType: 'item' })
  @Endpoint({
    summary: 'Criar item a partir de texto livre (e-mail, bilhete, documento)',
    description:
      'Requer `ai.use` e `item.create`. A IA só decide qual texto vai em qual coluna; a conversão/' +
      'validação final usa a mesma função determinística de colar células/importar planilhas.',
    tags: ['ai'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateItemFromTextBody,
    response: z.object({ item: ItemSchema, skippedColumns: z.array(z.string()) }),
  })
  createItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateItemFromTextBody>,
  ) {
    return this.itemCreation.createFromText(user, params.boardId, body.text, body.groupId);
  }

  @Post('items/:itemId/ai/summary')
  @Audited({ action: 'ai.item.summary', entityType: 'item' })
  @Endpoint({
    summary: 'Resumir as atualizações recentes do item',
    description: 'Requer `ai.use`.',
    tags: ['ai'],
    status: 200,
    params: S.ItemParams,
    response: S.SummaryResponseSchema,
  })
  summary(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ItemParams>) {
    return this.content.summarizeItemUpdates(user, params.itemId);
  }

  @Get('boards/:boardId/ai/status-report-summary')
  @Endpoint({
    summary: 'Narrar em linguagem natural o status report do board',
    description: 'Requer `ai.use`. Não recalcula EVM/risco/saúde — só narra o que já foi calculado.',
    tags: ['ai'],
    params: S.BoardParams,
    response: S.SummaryResponseSchema,
  })
  statusReportSummary(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return this.content.statusReportSummary(user, params.boardId);
  }

  @Post('items/:itemId/ai/generate-description')
  @Audited({ action: 'ai.item.generate_description', entityType: 'item' })
  @Endpoint({
    summary: 'Gerar descrição do serviço a partir do item (sugestão — o front decide se aplica)',
    description: 'Requer `ai.use`.',
    tags: ['ai'],
    status: 200,
    params: S.ItemParams,
    response: S.DescriptionResponseSchema,
  })
  generateDescription(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ItemParams>) {
    return this.content.generateDescription(user, params.itemId);
  }

  @Get('boards/:boardId/ai/predictions')
  @Endpoint({
    summary: 'Previsões do board: risco de atraso, sugestão de responsável e itens duplicados',
    description:
      'Requer `ai.use`. Risco de atraso e duplicados são cálculos determinísticos; só a narrativa ' +
      'final usa o provedor de IA.',
    tags: ['ai'],
    params: S.BoardParams,
    response: S.PredictionsResponseSchema,
  })
  getPredictions(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return this.predictions.forBoard(user, params.boardId);
  }
}

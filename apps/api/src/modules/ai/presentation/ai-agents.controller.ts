import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { AiAgentsService } from '../application/ai-agents.service.js';
import * as S from './schemas.js';

/**
 * Agentes de IA configuráveis (ADR 0055): CRUD (`ai.agents.manage`) e ciclo de aprovação das
 * propostas que o worker gera (`ai.agents.approve`). `approve`/`revert` rodam em transação própria
 * com `actorKind: 'automation'` dentro do service — por isso `transactional: false` aqui.
 */
@Controller()
export class AiAgentsController {
  constructor(private readonly agents: AiAgentsService) {}

  @Get('boards/:boardId/ai-agents')
  @Endpoint({
    summary: 'Listar agentes de IA do board',
    description: 'Requer `ai.agents.manage`.',
    tags: ['ai'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.AiAgentSchema) }),
  })
  async list(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return { data: await this.agents.listForBoard(user, params.boardId) };
  }

  @Post('boards/:boardId/ai-agents')
  @Audited({ action: 'ai_agent.create', entityType: 'ai_agent' })
  @Endpoint({
    summary: 'Criar agente de IA do board',
    description: 'Requer `ai.agents.manage`. Toda ação proposta exige aprovação humana antes de executar.',
    tags: ['ai'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateAiAgentBody,
    response: S.AiAgentSchema,
  })
  create(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateAiAgentBody>,
  ) {
    return this.agents.createForBoard(user, params.boardId, body);
  }

  @Patch('ai-agents/:id')
  @Audited({ action: 'ai_agent.update', entityType: 'ai_agent' })
  @Endpoint({
    summary: 'Atualizar agente de IA',
    tags: ['ai'],
    params: S.AgentParams,
    body: S.UpdateAiAgentBody,
    response: S.AiAgentSchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.AgentParams>,
    @Input('body') body: z.infer<typeof S.UpdateAiAgentBody>,
  ) {
    return this.agents.update(user, params.id, body);
  }

  @Delete('ai-agents/:id')
  @Audited({ action: 'ai_agent.delete', entityType: 'ai_agent' })
  @Endpoint({ summary: 'Excluir agente de IA', tags: ['ai'], params: S.AgentParams, status: 204 })
  async remove(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.AgentParams>) {
    await this.agents.remove(user, params.id);
  }

  @Get('ai-agents/:id/runs')
  @Endpoint({
    summary: 'Listar as execuções (propostas) de um agente de IA',
    description: 'Requer `ai.agents.approve`.',
    tags: ['ai'],
    params: S.AgentParams,
    response: z.object({ data: z.array(S.AiAgentRunSchema) }),
  })
  async runs(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.AgentParams>) {
    return { data: await this.agents.listRuns(user, params.id) };
  }

  @Post('ai-agent-runs/:id/approve')
  @Audited({ action: 'ai_agent_run.approve', entityType: 'ai_agent_run', transactional: false })
  @Endpoint({
    summary: 'Aprovar e executar a ação proposta por um agente de IA',
    description:
      'Requer `ai.agents.approve`. Executa a ação de verdade (via o service real da coluna/grupo) ' +
      'e captura o estado "antes" para permitir reverter.',
    tags: ['ai'],
    status: 200,
    params: S.RunParams,
    body: S.DecideRunBody,
    response: S.AiAgentRunSchema,
  })
  approve(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.RunParams>,
    @Input('body') body: z.infer<typeof S.DecideRunBody>,
  ) {
    return this.agents.approve(user, params.id, body.note);
  }

  @Post('ai-agent-runs/:id/reject')
  @Audited({ action: 'ai_agent_run.reject', entityType: 'ai_agent_run' })
  @Endpoint({
    summary: 'Rejeitar a ação proposta por um agente de IA (nada é executado)',
    description: 'Requer `ai.agents.approve`.',
    tags: ['ai'],
    status: 200,
    params: S.RunParams,
    body: S.DecideRunBody,
    response: S.AiAgentRunSchema,
  })
  reject(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.RunParams>,
    @Input('body') body: z.infer<typeof S.DecideRunBody>,
  ) {
    return this.agents.reject(user, params.id, body.note);
  }

  @Post('ai-agent-runs/:id/revert')
  @Audited({ action: 'ai_agent_run.revert', entityType: 'ai_agent_run', transactional: false })
  @Endpoint({
    summary: 'Reverter uma ação já executada por um agente de IA (quando reversível)',
    description: 'Requer `ai.agents.approve`. Só `set_column_value`/`move_to_group` executados são revertíveis.',
    tags: ['ai'],
    status: 200,
    params: S.RunParams,
    response: S.AiAgentRunSchema,
  })
  revert(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.RunParams>) {
    return this.agents.revert(user, params.id);
  }
}

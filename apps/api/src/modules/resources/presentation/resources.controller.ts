import { Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import { Audited, ReadOnlyOperation } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { AbsencesService } from '../application/absences.service.js';
import { AllocationsService } from '../application/allocations.service.js';
import { CapacityService } from '../application/capacity.service.js';
import { ResourceProfilesService } from '../application/resource-profiles.service.js';
import { ResourceRequestsService } from '../application/resource-requests.service.js';
import { SkillsService } from '../application/skills.service.js';
import { TeamsService } from '../application/teams.service.js';
import * as S from './schemas.js';

/**
 * Perfis de recurso, skills, alocações, ausências, solicitações e motor de capacidade (ADR 0052).
 * Timesheet (apontamento/aprovação) vive em `TimesheetController`, módulo separado.
 */
@Controller()
export class ResourcesController {
  constructor(
    private readonly profiles: ResourceProfilesService,
    private readonly skills: SkillsService,
    private readonly allocations: AllocationsService,
    private readonly absences: AbsencesService,
    private readonly requests: ResourceRequestsService,
    private readonly capacity: CapacityService,
    private readonly teams: TeamsService,
  ) {}

  // ----------------------------------------------------------------------------------- teams ---

  @Get('teams')
  @Endpoint({
    summary: 'Listar times do tenant (só leitura, usado para agrupar a Carga de trabalho)',
    tags: ['resources'],
    response: z.object({ data: z.array(S.TeamSchema) }),
  })
  async listTeams() {
    return { data: await this.teams.list() };
  }

  // ----------------------------------------------------------------------- resource profiles ---

  @Get('resource-profiles')
  @Endpoint({
    summary: 'Listar perfis de recurso do tenant',
    description: 'Requer `resources.manage` no workspace principal.',
    tags: ['resources'],
    response: z.object({ data: z.array(S.ResourceProfileSchema) }),
  })
  async listProfiles(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.profiles.list(user) };
  }

  @Get('users/:userId/resource-profile')
  @Endpoint({
    summary: 'Obter o perfil de recurso de uma pessoa',
    description: 'A própria pessoa pode ver o seu; ver o de outra exige `resources.manage`.',
    tags: ['resources'],
    params: S.UserParams,
    response: S.ResourceProfileSchema,
  })
  getProfile(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.UserParams>) {
    return this.profiles.get(user, params.userId);
  }

  @Put('users/:userId/resource-profile')
  @Audited({ action: 'resource_profile.upsert', entityType: 'resource_profile' })
  @Endpoint({
    summary: 'Criar/atualizar o perfil de recurso de uma pessoa',
    description: 'Requer `resources.manage`.',
    tags: ['resources'],
    params: S.UserParams,
    body: S.UpsertResourceProfileBody,
    response: S.ResourceProfileSchema,
  })
  upsertProfile(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.UserParams>,
    @Input('body') body: z.infer<typeof S.UpsertResourceProfileBody>,
  ) {
    return this.profiles.upsert(user, params.userId, body);
  }

  // --------------------------------------------------------------------------------- skills ---

  @Get('skills')
  @Endpoint({
    summary: 'Listar catálogo de skills do tenant',
    tags: ['resources'],
    response: z.object({ data: z.array(S.SkillSchema) }),
  })
  async listSkills() {
    return { data: await this.skills.list() };
  }

  @Post('skills')
  @Audited({ action: 'skill.create', entityType: 'skill' })
  @Endpoint({
    summary: 'Criar skill',
    description: 'Requer `resources.manage`.',
    tags: ['resources'],
    status: 201,
    body: S.CreateSkillBody,
    response: S.SkillSchema,
  })
  createSkill(@CurrentPrincipal() user: AuthPrincipal, @Input('body') body: z.infer<typeof S.CreateSkillBody>) {
    return this.skills.create(user, body);
  }

  @Patch('skills/:id')
  @Audited({ action: 'skill.update', entityType: 'skill' })
  @Endpoint({
    summary: 'Atualizar skill',
    description: 'Requer `resources.manage`.',
    tags: ['resources'],
    params: IdParams,
    body: S.UpdateSkillBody,
    response: S.SkillSchema,
  })
  updateSkill(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateSkillBody>,
  ) {
    return this.skills.update(user, params.id, body);
  }

  @Delete('skills/:id')
  @Audited({ action: 'skill.delete', entityType: 'skill' })
  @Endpoint({ summary: 'Excluir skill', tags: ['resources'], params: IdParams, status: 204 })
  async removeSkill(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof IdParams>) {
    await this.skills.remove(user, params.id);
  }

  @Get('users/:userId/skills')
  @Endpoint({
    summary: 'Listar as competências de uma pessoa',
    tags: ['resources'],
    params: S.UserParams,
    response: z.object({ data: z.array(S.UserSkillSchema) }),
  })
  async listUserSkills(@Input('params') params: z.infer<typeof S.UserParams>) {
    return { data: await this.skills.listForUser(params.userId) };
  }

  @Put('users/:userId/skills')
  @Audited({ action: 'user_skills.set', entityType: 'user_skills' })
  @Endpoint({
    summary: 'Substituir as competências de uma pessoa',
    description: 'Requer `resources.manage`.',
    tags: ['resources'],
    params: S.UserParams,
    body: S.SetUserSkillsBody,
    response: z.object({ data: z.array(S.UserSkillSchema) }),
  })
  async setUserSkills(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.UserParams>,
    @Input('body') body: z.infer<typeof S.SetUserSkillsBody>,
  ) {
    return { data: await this.skills.setForUser(user, params.userId, body.entries) };
  }

  // --------------------------------------------------------------------------- allocations ---

  @Get('boards/:boardId/allocations')
  @Endpoint({
    summary: 'Listar alocações de um board',
    tags: ['resources'],
    params: S.BoardParams,
    query: S.AllocationRangeQuery,
    response: z.object({ data: z.array(S.AllocationSchema) }),
  })
  async listBoardAllocations(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('query') query: z.infer<typeof S.AllocationRangeQuery>,
  ) {
    return { data: await this.allocations.listForBoard(user, params.boardId, query) };
  }

  @Get('users/:userId/allocations')
  @Endpoint({
    summary: 'Listar alocações de uma pessoa num período',
    description: 'A própria pessoa pode ver as suas; ver as de outra exige `resources.manage`.',
    tags: ['resources'],
    params: S.UserParams,
    query: S.AllocationUserRangeQuery,
    response: z.object({ data: z.array(S.AllocationSchema) }),
  })
  async listUserAllocations(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.UserParams>,
    @Input('query') query: z.infer<typeof S.AllocationUserRangeQuery>,
  ) {
    return { data: await this.allocations.listForUser(user, params.userId, query) };
  }

  @Post('allocations')
  @Audited({ action: 'allocation.create', entityType: 'allocation' })
  @Endpoint({
    summary: 'Criar alocação planejada',
    description: 'Requer `resources.manage`. Não bloqueia por sobrealocação (sinalizada no heatmap).',
    tags: ['resources'],
    status: 201,
    body: S.CreateAllocationBody,
    response: S.AllocationSchema,
  })
  createAllocation(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.CreateAllocationBody>,
  ) {
    return this.allocations.create(user, body);
  }

  @Patch('allocations/:id')
  @Audited({ action: 'allocation.update', entityType: 'allocation' })
  @Endpoint({
    summary: 'Atualizar alocação (redistribuição/nivelamento)',
    tags: ['resources'],
    params: IdParams,
    body: S.UpdateAllocationBody,
    response: S.AllocationSchema,
  })
  updateAllocation(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateAllocationBody>,
  ) {
    return this.allocations.update(user, params.id, body);
  }

  @Delete('allocations/:id')
  @Audited({ action: 'allocation.delete', entityType: 'allocation' })
  @Endpoint({ summary: 'Excluir alocação', tags: ['resources'], params: IdParams, status: 204 })
  async removeAllocation(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof IdParams>) {
    await this.allocations.remove(user, params.id);
  }

  // ------------------------------------------------------------------------------ absences ---

  @Get('users/:userId/absences')
  @Endpoint({
    summary: 'Listar ausências de uma pessoa',
    tags: ['resources'],
    params: S.UserParams,
    response: z.object({ data: z.array(S.AbsenceSchema) }),
  })
  async listAbsences(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.UserParams>,
  ) {
    return { data: await this.absences.listForUser(user, params.userId) };
  }

  @Post('absences')
  @Audited({ action: 'absence.request', entityType: 'absence' })
  @Endpoint({
    summary: 'Solicitar a própria ausência (férias, licença, treinamento, folga)',
    tags: ['resources'],
    status: 201,
    body: S.RequestAbsenceBody,
    response: S.AbsenceSchema,
  })
  requestAbsence(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.RequestAbsenceBody>,
  ) {
    return this.absences.request(user, body);
  }

  @Post('absences/:id/decide')
  @Audited({ action: 'absence.decide', entityType: 'absence' })
  @Endpoint({
    summary: 'Aprovar/recusar uma solicitação de ausência',
    description: 'Requer `resources.manage` ou `timesheet.approve`.',
    tags: ['resources'],
    status: 200,
    params: IdParams,
    body: S.DecideAbsenceBody,
    response: S.AbsenceSchema,
  })
  decideAbsence(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.DecideAbsenceBody>,
  ) {
    return this.absences.decide(user, params.id, body.status);
  }

  @Delete('absences/:id')
  @Audited({ action: 'absence.cancel', entityType: 'absence' })
  @Endpoint({ summary: 'Cancelar a própria solicitação de ausência pendente', tags: ['resources'], params: IdParams, status: 204 })
  async removeAbsence(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof IdParams>) {
    await this.absences.remove(user, params.id);
  }

  // ----------------------------------------------------------------------- resource requests ---

  @Get('boards/:boardId/resource-requests')
  @Endpoint({
    summary: 'Listar solicitações de recurso de um board',
    tags: ['resources'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.ResourceRequestSchema) }),
  })
  async listBoardResourceRequests(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return { data: await this.requests.listForBoard(user, params.boardId) };
  }

  @Get('resource-requests')
  @Endpoint({
    summary: 'Listar todas as solicitações de recurso abertas do tenant',
    description: 'Requer `resources.manage`.',
    tags: ['resources'],
    response: z.object({ data: z.array(S.ResourceRequestSchema) }),
  })
  async listOpenResourceRequests(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.requests.listOpen(user) };
  }

  @Post('boards/:boardId/resource-requests')
  @Audited({ action: 'resource_request.create', entityType: 'resource_request' })
  @Endpoint({
    summary: 'Solicitar um perfil/competência para o board',
    description: 'Requer `board.manage`.',
    tags: ['resources'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateResourceRequestBody,
    response: S.ResourceRequestSchema,
  })
  createResourceRequest(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateResourceRequestBody>,
  ) {
    return this.requests.create(user, { ...body, boardId: params.boardId });
  }

  @Post('resource-requests/:id/assign')
  @Audited({ action: 'resource_request.assign', entityType: 'resource_request' })
  @Endpoint({
    summary: 'Atribuir uma pessoa à solicitação de recurso',
    description: 'Requer `resources.manage`. A alocação em si é criada separadamente.',
    tags: ['resources'],
    status: 200,
    params: IdParams,
    body: S.AssignResourceRequestBody,
    response: S.ResourceRequestSchema,
  })
  assignResourceRequest(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.AssignResourceRequestBody>,
  ) {
    return this.requests.assign(user, params.id, body.assignedUserId);
  }

  @Post('resource-requests/:id/cancel')
  @Audited({ action: 'resource_request.cancel', entityType: 'resource_request' })
  @Endpoint({
    summary: 'Cancelar uma solicitação de recurso aberta',
    tags: ['resources'],
    status: 200,
    params: IdParams,
    response: S.ResourceRequestSchema,
  })
  cancelResourceRequest(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof IdParams>) {
    return this.requests.cancel(user, params.id);
  }

  // -------------------------------------------------------------------------------- capacity ---

  @Get('capacity/heatmap')
  @Endpoint({
    summary: 'Heatmap de capacidade (disponível × alocado) por pessoa, time ou skill',
    description: 'Ver só a própria capacidade não exige permissão; ver a de outras pessoas exige `resources.manage`/`timesheet.approve`.',
    tags: ['resources'],
    query: S.CapacityScopeQuery,
    response: S.HeatmapResponseSchema,
  })
  heatmap(@CurrentPrincipal() user: AuthPrincipal, @Input('query') query: z.infer<typeof S.CapacityScopeQuery>) {
    return this.capacity.heatmap(user, query);
  }

  @Get('capacity/leveling-suggestions')
  @Endpoint({
    summary: 'Sugestões automáticas de nivelamento de carga',
    description: 'Sugestão (gulosa), nunca aplicada automaticamente — aplicar é uma edição normal de alocação.',
    tags: ['resources'],
    query: S.LevelingQuery,
    response: z.object({ data: z.array(S.LevelingSuggestionSchema) }),
  })
  async levelingSuggestions(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof S.LevelingQuery>,
  ) {
    return { data: await this.capacity.levelingSuggestions(user, query) };
  }

  @Post('capacity/what-if')
  @ReadOnlyOperation()
  @Endpoint({
    summary: 'Simulação what-if de alocação (não grava nada)',
    tags: ['resources'],
    status: 200,
    body: S.WhatIfBody,
    response: S.WhatIfResponseSchema,
  })
  whatIf(@CurrentPrincipal() user: AuthPrincipal, @Input('body') body: z.infer<typeof S.WhatIfBody>) {
    return this.capacity.whatIf(user, body);
  }

  @Get('capacity/forecast')
  @Endpoint({
    summary: 'Previsão de demanda × capacidade (3/6/12 meses)',
    description: 'Requer `resources.manage` ou `timesheet.approve`.',
    tags: ['resources'],
    query: S.ForecastQuery,
    response: z.object({ data: z.array(S.ForecastBucketSchema) }),
  })
  async forecast(@CurrentPrincipal() user: AuthPrincipal, @Input('query') query: z.infer<typeof S.ForecastQuery>) {
    return { data: await this.capacity.forecast(user, query.months) };
  }
}

import { Controller, Get, Headers, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { UnauthorizedError } from '../../../core/errors/problems.js';
import { PublicShareService } from '../application/public-share.service.js';
import { ShareSessionService, type VerifiedShareSession } from '../infrastructure/share-session.service.js';
import * as S from './schemas.js';

/** Cabeçalho da sessão de leitura de um link público (ADR 0047) — distinto do `Authorization`. */
const SHARE_SESSION_HEADER = 'x-share-session';

/** Leitura pública (sem autenticação) de uma view compartilhada por link: resolver, verificar senha
 * e, com a sessão emitida, ler o board e os itens (somente leitura, colunas ocultas redigidas). */
@Controller('public/share')
export class PublicShareController {
  constructor(
    private readonly publicShare: PublicShareService,
    private readonly shareSessions: ShareSessionService,
  ) {}

  @Get(':token/info')
  @Endpoint({
    summary: 'Metadados do link público (se exige senha), sem criar sessão',
    tags: ['public'],
    public: true,
    params: S.ShareTokenParams,
    response: S.PublicShareInfoResponse,
  })
  info(@Input('params') params: z.infer<typeof S.ShareTokenParams>) {
    return this.publicShare.info(params.token);
  }

  @Post(':token/verify')
  // Rota pública (sem principal): o serviço abre suas próprias transações/auditoria (ADR 0047),
  // como nos fluxos de autenticação — o interceptor global não as abre sem um principal autenticado.
  @Audited({ action: 'share_link.access', entityType: 'share_link', transactional: false })
  @Endpoint({
    summary: 'Verifica o link (senha, se exigida) e emite a sessão de leitura (1h)',
    tags: ['public'],
    public: true,
    status: 200,
    params: S.ShareTokenParams,
    body: S.PublicVerifyBody,
    response: S.PublicVerifyResponse,
  })
  verify(
    @Input('params') params: z.infer<typeof S.ShareTokenParams>,
    @Input('body') body: z.infer<typeof S.PublicVerifyBody>,
  ) {
    return this.publicShare.verify(params.token, body.password);
  }

  @Get('board')
  @Endpoint({
    summary: 'Board, colunas e grupos da view compartilhada (sessão obrigatória)',
    tags: ['public'],
    public: true,
    response: S.PublicBoardResponse,
  })
  async board(@Headers(SHARE_SESSION_HEADER) sessionToken: string | undefined) {
    return this.publicShare.board(await this.session(sessionToken));
  }

  @Get('items')
  @Endpoint({
    summary: 'Itens de topo da view compartilhada (até 1000, colunas ocultas redigidas)',
    tags: ['public'],
    public: true,
    query: S.PublicItemsQuery,
    response: S.PublicItemsResponse,
  })
  async items(
    @Headers(SHARE_SESSION_HEADER) sessionToken: string | undefined,
    @Input('query') query: z.infer<typeof S.PublicItemsQuery>,
  ) {
    return this.publicShare.items(await this.session(sessionToken), query.q);
  }

  private async session(token: string | undefined): Promise<VerifiedShareSession> {
    if (token === undefined || token.trim() === '') {
      throw new UnauthorizedError('share_session_invalid', 'Sessão de link público ausente.');
    }
    return this.shareSessions.verify(token);
  }
}

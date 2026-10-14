import { Controller, Get } from '@nestjs/common';
import { SEARCH_INDEXES } from '@cube-track/shared';
import { Args, Int, Query, Resolver, Field, ObjectType, ID } from '@nestjs/graphql';
import { z } from 'zod';

import { CurrentPrincipal } from '../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../core/context/request-context.js';
import { Endpoint, Input } from '../../core/http/endpoint.js';
import { RateLimit } from '../../core/rate-limit/rate-limit.js';
import { SearchService } from './search.service.js';

const ALL_TYPES = Object.values(SEARCH_INDEXES);
const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  types: z
    .string()
    .optional()
    .transform((raw) =>
      raw === undefined ? ALL_TYPES : raw.split(',').map((entry) => entry.trim()),
    )
    .pipe(z.array(z.enum(ALL_TYPES)).min(1)),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
const HitSchema = z.object({
  id: z.string(),
  type: z.enum(ALL_TYPES),
  title: z.string(),
  boardId: z.string(),
  itemId: z.string().nullable(),
  snippet: z.string().nullable(),
});

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60, by: 'user', bucket: 'search' })
  @Endpoint({
    summary: 'Busca global (itens, boards e atualizações) respeitando permissões',
    tags: ['search'],
    query: SearchQuery,
    response: z.object({ data: z.array(HitSchema) }),
  })
  async find(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof SearchQuery>,
  ) {
    return { data: await this.search.search(user, query.q, query.types, query.limit) };
  }
}

@ObjectType()
export class SearchHitType {
  @Field(() => ID) id!: string;
  @Field() type!: string;
  @Field() title!: string;
  @Field() boardId!: string;
  @Field(() => String, { nullable: true }) itemId!: string | null;
  @Field(() => String, { nullable: true }) snippet!: string | null;
}

@Resolver()
export class SearchResolver {
  constructor(private readonly searchService: SearchService) {}

  @Query(() => [SearchHitType])
  search(
    @CurrentPrincipal() user: AuthPrincipal,
    @Args('q') q: string,
    @Args('limit', { type: () => Int, defaultValue: 10 }) limit: number,
  ) {
    return this.searchService.search(
      user,
      q.trim().slice(0, 200),
      ALL_TYPES,
      Math.min(Math.max(limit, 1), 50),
    );
  }
}

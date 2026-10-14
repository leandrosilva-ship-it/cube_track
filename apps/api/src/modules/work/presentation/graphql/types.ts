import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { JSONScalar } from './json.scalar.js';

@ObjectType()
export class WorkspaceType {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field(() => String, { nullable: true }) description!: string | null;
  @Field() visibility!: string;
  @Field(() => [String]) enabledModules!: string[];
}

@ObjectType()
export class BoardSummaryType {
  @Field(() => ID) id!: string;
  @Field(() => ID) workspaceId!: string;
  @Field() kind!: string;
  @Field() name!: string;
  @Field(() => String, { nullable: true }) description!: string | null;
}

@ObjectType()
export class GroupType {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field() color!: string;
  @Field() position!: string;
}

@ObjectType()
export class LabelType {
  @Field(() => ID) id!: string;
  @Field() label!: string;
  @Field() color!: string;
  @Field() position!: string;
}

@ObjectType()
export class ColumnType {
  @Field(() => ID) id!: string;
  @Field() key!: string;
  @Field() type!: string;
  @Field() title!: string;
  @Field(() => String, { nullable: true }) binding!: string | null;
  @Field(() => JSONScalar) settings!: Record<string, unknown>;
  @Field() canEdit!: boolean;
  @Field(() => [LabelType]) labels!: LabelType[];
}

@ObjectType()
export class BoardType {
  @Field(() => ID) id!: string;
  @Field(() => ID) workspaceId!: string;
  @Field() kind!: string;
  @Field() name!: string;
  @Field(() => Int) seq!: number;
  @Field(() => [String]) permissions!: string[];
  @Field() itemScope!: string;
  @Field(() => [GroupType]) groups!: GroupType[];
  @Field(() => [ColumnType]) columns!: ColumnType[];
}

@ObjectType()
export class ItemType {
  @Field(() => ID) id!: string;
  @Field(() => ID) boardId!: string;
  @Field(() => ID) groupId!: string;
  @Field(() => ID, { nullable: true }) parentItemId!: string | null;
  @Field() name!: string;
  @Field() position!: string;
  @Field(() => JSONScalar) values!: Record<string, unknown>;
  @Field(() => JSONScalar) fieldVersions!: Record<string, number>;
  @Field(() => Int) version!: number;
  @Field(() => String, { nullable: true }) plannedStartDate!: string | null;
  @Field(() => String, { nullable: true }) plannedEndDate!: string | null;
  @Field(() => String, { nullable: true }) replannedStartDate!: string | null;
  @Field(() => String, { nullable: true }) replannedEndDate!: string | null;
  @Field(() => String, { nullable: true }) actualStartDate!: string | null;
  @Field(() => String, { nullable: true }) actualEndDate!: string | null;
  @Field(() => String, { nullable: true }) progress!: string | null;
  @Field() updatedAt!: string;
  @Field(() => [String]) redactedFields!: string[];
}

@ObjectType()
export class PageInfoType {
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
  @Field() hasNextPage!: boolean;
}

@ObjectType()
export class ItemConnectionType {
  @Field(() => [ItemType]) data!: ItemType[];
  @Field(() => PageInfoType) pageInfo!: PageInfoType;
}

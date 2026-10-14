import { GraphQLScalarType, Kind, type ValueNode } from 'graphql';

function parseLiteral(ast: ValueNode): unknown {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.OBJECT:
      return Object.fromEntries(
        ast.fields.map((field) => [field.name.value, parseLiteral(field.value)]),
      );
    case Kind.LIST:
      return ast.values.map(parseLiteral);
    case Kind.NULL:
      return null;
    default:
      throw new TypeError(`Literal JSON não suportado: ${ast.kind}`);
  }
}

/** Escalar JSON (valores de colunas customizadas e filtros). */
export const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Valor JSON arbitrário.',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral,
});

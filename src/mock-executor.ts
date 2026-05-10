import {
  execute,
  isObjectType,
  GraphQLError,
  type GraphQLSchema,
  type DocumentNode,
  type ExecutionResult,
} from 'graphql';
import { addMocksToSchema } from '@graphql-tools/mock';
import { seed } from '@ngneat/falso';
import { pruneDocument } from './request-analyzer';
import { scalarMocks, fakeTypeGenerators, type FakeType } from './falso-mocks';

export type Generators = Record<string, () => unknown>;

const MOCK_SEED = '1';

const DEFAULT_ERROR_MESSAGE =
  'Unable to process your request at this moment. Please check your information and try again.';

function intArg(
  directives: readonly any[],
  directiveName: string,
  argName: string,
): number | null {
  const dir = directives?.find((d: any) => d.name.value === directiveName);
  const arg = dir?.arguments?.find((a: any) => a.name.value === argName);
  return arg?.value.kind === 'IntValue' ? parseInt(arg.value.value, 10) : null;
}

function stringArg(
  directives: readonly any[],
  directiveName: string,
  argName: string,
): string | null {
  const dir = directives?.find((d: any) => d.name.value === directiveName);
  const arg = dir?.arguments?.find((a: any) => a.name.value === argName);
  return arg?.value.kind === 'StringValue' ? arg.value.value : null;
}

// Walk schema fields and build resolver overrides for @fake, @listSize, and @error directives
function buildFakeResolvers(
  schema: GraphQLSchema,
  allScalarGenerators: Record<string, () => unknown>,
): Record<string, Record<string, () => unknown>> {
  const resolvers: Record<string, Record<string, () => unknown>> = {};

  for (const [typeName, type] of Object.entries(schema.getTypeMap())) {
    if (typeName.startsWith('__') || !isObjectType(type)) continue;

    for (const [fieldName, field] of Object.entries(type.getFields())) {
      const directives = field.astNode?.directives ?? [];

      const errorDir = directives.find((d) => d.name.value === 'error');
      if (errorDir) {
        const message =
          stringArg(directives, 'error', 'message') ?? DEFAULT_ERROR_MESSAGE;
        const code =
          stringArg(directives, 'error', 'code') ?? 'DOWNSTREAM_SERVICE_ERROR';
        const classification =
          stringArg(directives, 'error', 'classification') ?? 'BAD_REQUEST';
        const serviceName = stringArg(directives, 'error', 'serviceName');
        const statusCode = intArg(directives, 'error', 'statusCode') ?? 200;
        if (!resolvers[typeName]) resolvers[typeName] = {};
        resolvers[typeName][fieldName] = () => {
          throw new GraphQLError(message, {
            extensions: {
              classification,
              code,
              ...(serviceName ? { serviceName } : {}),
              statusCode,
              ...(statusCode !== 200 ? { http: { status: statusCode } } : {}),
            },
          });
        };
        continue;
      }

      const listSizeDir = directives.find((d) => d.name.value === 'listSize');
      if (listSizeDir) {
        const count = intArg(directives, 'listSize', 'count');
        const min = intArg(directives, 'listSize', 'min') ?? 1;
        const max = intArg(directives, 'listSize', 'max') ?? 10;
        if (!resolvers[typeName]) resolvers[typeName] = {};
        resolvers[typeName][fieldName] = () => {
          const length =
            count ?? Math.floor(Math.random() * (max - min + 1)) + min;
          return Array.from({ length }, () => ({}));
        };
        continue;
      }

      const fakeDir = directives.find((d) => d.name.value === 'fake');
      if (!fakeDir) continue;

      const oneOfArg = fakeDir.arguments?.find((a) => a.name.value === 'oneOf');
      if (oneOfArg?.value.kind === 'ListValue') {
        const values = oneOfArg.value.values
          .filter((v) => v.kind === 'StringValue')
          .map((v) => (v as any).value as string);
        if (values.length > 0) {
          if (!resolvers[typeName]) resolvers[typeName] = {};
          resolvers[typeName][fieldName] = () =>
            values[Math.floor(Math.random() * values.length)];
          continue;
        }
      }

      const typeArg = fakeDir.arguments?.find((a) => a.name.value === 'type');
      if (!typeArg || typeArg.value.kind !== 'EnumValue') continue;

      const generator = allScalarGenerators[typeArg.value.value as FakeType];
      if (!generator) continue;

      if (!resolvers[typeName]) resolvers[typeName] = {};
      resolvers[typeName][fieldName] = generator;
    }
  }

  return resolvers;
}

export function buildMockSchema(
  mergedSchema: GraphQLSchema,
  generators: Generators = {},
): GraphQLSchema {
  // Uppercase key = GraphQL type generator (e.g. Airport); lowercase = scalar generator (e.g. flightNumber)
  const typeGenerators: Generators = {};
  const scalarGeneratorOverrides: Generators = {};
  for (const [key, fn] of Object.entries(generators)) {
    if (key[0] === key[0].toUpperCase()) typeGenerators[key] = fn;
    else scalarGeneratorOverrides[key] = fn;
  }

  const allScalarGenerators = {
    ...fakeTypeGenerators,
    ...scalarGeneratorOverrides,
  };

  return addMocksToSchema({
    schema: mergedSchema,
    mocks: { ...scalarMocks, ...typeGenerators },
    resolvers: buildFakeResolvers(mergedSchema, allScalarGenerators),
  });
}

export async function executeMock(
  mockSchema: GraphQLSchema,
  document: DocumentNode,
  variables: Record<string, unknown>,
  operationName: string | null | undefined,
  rootFieldNames: string[],
): Promise<ExecutionResult> {
  const pruned = pruneDocument(document, rootFieldNames, operationName);
  //seed(MOCK_SEED)
  return execute({
    schema: mockSchema,
    document: pruned,
    variableValues: variables,
    operationName: operationName ?? undefined,
  });
}

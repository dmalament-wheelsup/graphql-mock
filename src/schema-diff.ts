import { readFileSync } from 'fs'
import {
  buildClientSchema,
  getIntrospectionQuery,
  extendSchema,
  parse,
  isObjectType,
  type GraphQLSchema,
} from 'graphql'
import { mapSchema, MapperKind } from '@graphql-tools/utils'
import { buildFakeDirectiveSDL } from './falso-mocks'

export interface SchemaDiff {
  mergedSchema: GraphQLSchema
  liveSchema: GraphQLSchema
  liveFields: Set<string>       // "TypeName.fieldName"
  newRootFields: Set<string>    // "Query.foo", "Mutation.bar"
  overriddenFields: Set<string> // fields redefined in extensions (type changed)
}

async function introspectLiveSchema(
  endpointUrl: string,
  headers?: Record<string, string>
): Promise<GraphQLSchema> {
  const res = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  })
  if (!res.ok) {
    throw new Error(`Introspection failed: HTTP ${res.status} from ${endpointUrl}`)
  }
  const json = (await res.json()) as any
  if (json.errors?.length) {
    throw new Error(`Introspection query returned errors: ${json.errors[0].message}`)
  }
  return buildClientSchema(json.data)
}

function buildLiveFieldsSet(schema: GraphQLSchema): Set<string> {
  const liveFields = new Set<string>()
  for (const [typeName, type] of Object.entries(schema.getTypeMap())) {
    if (typeName.startsWith('__') || !isObjectType(type)) continue
    for (const fieldName of Object.keys(type.getFields())) {
      liveFields.add(`${typeName}.${fieldName}`)
    }
  }
  return liveFields
}

// Find fields in the extensions SDL that already exist on the live schema
// (i.e. type changes/overrides). Returns Map<typeName, Set<fieldName>>.
function detectOverrides(
  extensionsSdl: string,
  liveSchema: GraphQLSchema
): Map<string, Set<string>> {
  const overrides = new Map<string, Set<string>>()
  if (!extensionsSdl.trim()) return overrides
  const doc = parse(extensionsSdl)

  for (const def of doc.definitions) {
    if (def.kind !== 'ObjectTypeExtension') continue
    const typeName = def.name.value
    const liveType = liveSchema.getType(typeName)
    if (!liveType || !isObjectType(liveType)) continue

    const liveFieldNames = new Set(Object.keys(liveType.getFields()))
    for (const field of def.fields ?? []) {
      if (liveFieldNames.has(field.name.value)) {
        if (!overrides.has(typeName)) overrides.set(typeName, new Set())
        overrides.get(typeName)!.add(field.name.value)
      }
    }
  }
  return overrides
}

// Strip overridden fields from the live schema before merging extensions onto it
function stripOverriddenFields(
  schema: GraphQLSchema,
  overrides: Map<string, Set<string>>
): GraphQLSchema {
  if (overrides.size === 0) return schema
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig, fieldName, typeName) => {
      return overrides.get(typeName)?.has(fieldName) ? null : fieldConfig
    },
  })
}

export async function buildSchemaDiff(
  schemaPath: string,
  endpointUrl: string,
  headers?: Record<string, string>,
  customScalarGeneratorNames: string[] = []
): Promise<SchemaDiff> {
  const liveSchema = await introspectLiveSchema(endpointUrl, headers)
  const liveFields = buildLiveFieldsSet(liveSchema)

  const extensionsSdl = readFileSync(schemaPath, 'utf-8')

  // Detect and handle field overrides (type changes)
  const overrides = detectOverrides(extensionsSdl, liveSchema)
  const overriddenFields = new Set<string>()
  for (const [typeName, fieldNames] of overrides) {
    for (const fieldName of fieldNames) {
      const key = `${typeName}.${fieldName}`
      overriddenFields.add(key)
      liveFields.delete(key) // route to mock instead of proxy
    }
  }

  // Strip overridden fields, then apply extensions + @fake directive
  const strippedSchema = stripOverriddenFields(liveSchema, overrides)
  const combinedSDL = extensionsSdl.trim() + buildFakeDirectiveSDL(customScalarGeneratorNames)
  const mergedSchema = extendSchema(strippedSchema, parse(combinedSDL), {
    assumeValidSDL: true,
  })

  // Identify new root fields (in merged schema but not in liveFields)
  const newRootFields = new Set<string>()
  for (const fieldName of Object.keys(mergedSchema.getQueryType()?.getFields() ?? {})) {
    if (!liveFields.has(`Query.${fieldName}`)) newRootFields.add(`Query.${fieldName}`)
  }
  for (const fieldName of Object.keys(mergedSchema.getMutationType()?.getFields() ?? {})) {
    if (!liveFields.has(`Mutation.${fieldName}`)) newRootFields.add(`Mutation.${fieldName}`)
  }

  return { mergedSchema, liveSchema, liveFields, newRootFields, overriddenFields }
}

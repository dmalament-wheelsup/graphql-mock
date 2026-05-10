import {
  type DocumentNode,
  type SelectionSetNode,
  type FieldNode,
  type SelectionNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type GraphQLSchema,
  Kind,
  isObjectType,
} from 'graphql'
import type { SchemaDiff } from './schema-diff'

// Walk a selection set and return true if any field is absent from liveFields
function subtreeHasNewField(
  selectionSet: SelectionSetNode,
  parentTypeName: string,
  schema: GraphQLSchema,
  liveFields: Set<string>,
  fragments: Map<string, FragmentDefinitionNode>
): boolean {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const fieldName = selection.name.value
      if (fieldName.startsWith('__')) continue // introspection fields always live

      if (!liveFields.has(`${parentTypeName}.${fieldName}`)) return true

      if (selection.selectionSet) {
        const parentType = schema.getType(parentTypeName)
        if (!isObjectType(parentType)) continue
        const fieldDef = parentType.getFields()[fieldName]
        const subTypeName = getNamedTypeName(fieldDef?.type)
        if (
          subTypeName &&
          subtreeHasNewField(selection.selectionSet, subTypeName, schema, liveFields, fragments)
        ) {
          return true
        }
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT && selection.selectionSet) {
      const typeName = selection.typeCondition?.name.value ?? parentTypeName
      if (subtreeHasNewField(selection.selectionSet, typeName, schema, liveFields, fragments)) {
        return true
      }
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const frag = fragments.get(selection.name.value)
      if (
        frag &&
        subtreeHasNewField(frag.selectionSet, frag.typeCondition.name.value, schema, liveFields, fragments)
      ) {
        return true
      }
    }
  }
  return false
}

// Split a selection set into live-only and mock-only selections.
// A field goes to mock if it or any descendant is not in liveFields.
// A field goes to live if it and all descendants are in liveFields.
function splitSelectionSet(
  selectionSet: SelectionSetNode,
  parentTypeName: string,
  schema: GraphQLSchema,
  liveFields: Set<string>,
  fragments: Map<string, FragmentDefinitionNode>
): { live: SelectionNode[]; mock: SelectionNode[] } {
  const live: SelectionNode[] = []
  const mock: SelectionNode[] = []

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const fieldName = selection.name.value
      if (fieldName.startsWith('__')) {
        live.push(selection)
        continue
      }

      if (!liveFields.has(`${parentTypeName}.${fieldName}`)) {
        mock.push(selection)
        continue
      }

      if (!selection.selectionSet) {
        live.push(selection)
        continue
      }

      const parentType = schema.getType(parentTypeName)
      if (!isObjectType(parentType)) {
        live.push(selection)
        continue
      }
      const fieldDef = parentType.getFields()[fieldName]
      const subTypeName = getNamedTypeName(fieldDef?.type)

      if (!subTypeName || !subtreeHasNewField(selection.selectionSet, subTypeName, schema, liveFields, fragments)) {
        live.push(selection)
        continue
      }

      // This field is live but has mixed descendants — split its sub-selection
      const sub = splitSelectionSet(selection.selectionSet, subTypeName, schema, liveFields, fragments)

      if (sub.live.length > 0) {
        live.push({ ...selection, selectionSet: { ...selection.selectionSet, selections: sub.live } } as FieldNode)
      }
      if (sub.mock.length > 0) {
        mock.push({ ...selection, selectionSet: { ...selection.selectionSet, selections: sub.mock } } as FieldNode)
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT && selection.selectionSet) {
      const typeName = selection.typeCondition?.name.value ?? parentTypeName
      const sub = splitSelectionSet(selection.selectionSet, typeName, schema, liveFields, fragments)
      if (sub.live.length > 0) {
        live.push({ ...selection, selectionSet: { ...selection.selectionSet, selections: sub.live } })
      }
      if (sub.mock.length > 0) {
        mock.push({ ...selection, selectionSet: { ...selection.selectionSet, selections: sub.mock } })
      }
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const frag = fragments.get(selection.name.value)
      if (!frag) {
        live.push(selection)
        mock.push(selection)
        continue
      }
      const fragTypeName = frag.typeCondition.name.value
      const sub = splitSelectionSet(frag.selectionSet, fragTypeName, schema, liveFields, fragments)
      if (sub.live.length > 0) {
        live.push({
          kind: Kind.INLINE_FRAGMENT,
          typeCondition: frag.typeCondition,
          selectionSet: { kind: Kind.SELECTION_SET, selections: sub.live },
        })
      }
      if (sub.mock.length > 0) {
        mock.push({
          kind: Kind.INLINE_FRAGMENT,
          typeCondition: frag.typeCondition,
          selectionSet: { kind: Kind.SELECTION_SET, selections: sub.mock },
        })
      }
    } else {
      live.push(selection)
      mock.push(selection)
    }
  }

  return { live, mock }
}

function getNamedTypeName(type: any): string | null {
  if (!type) return null
  if (type.name) return type.name
  if (type.ofType) return getNamedTypeName(type.ofType)
  return null
}

export interface SplitRootField {
  fieldName: string
  liveSelections: SelectionNode[]
  mockSelections: SelectionNode[]
}

export interface AnalyzedRequest {
  liveRootFields: string[]
  mockRootFields: string[]
  splitRootFields: SplitRootField[]
}

export function analyzeRequest(
  document: DocumentNode,
  diff: SchemaDiff,
  operationName?: string | null
): AnalyzedRequest {
  const liveRootFields: string[] = []
  const mockRootFields: string[] = []
  const splitRootFields: SplitRootField[] = []

  const fragments = new Map<string, FragmentDefinitionNode>()
  for (const def of document.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def)
  }

  const operation = document.definitions.find(
    (def): def is OperationDefinitionNode =>
      def.kind === Kind.OPERATION_DEFINITION &&
      (!operationName || def.name?.value === operationName)
  )
  if (!operation) return { liveRootFields, mockRootFields, splitRootFields }

  const rootTypeName = operation.operation === 'mutation' ? 'Mutation' : 'Query'

  for (const selection of operation.selectionSet.selections) {
    if (selection.kind !== Kind.FIELD) continue
    const fieldName = selection.name.value
    if (fieldName.startsWith('__')) continue

    const isLiveRoot = diff.liveFields.has(`${rootTypeName}.${fieldName}`)
    if (!isLiveRoot) {
      mockRootFields.push(fieldName)
      continue
    }

    // Root field is live — but does its subtree touch any new fields?
    if (selection.selectionSet) {
      const rootType = rootTypeName === 'Mutation'
        ? diff.mergedSchema.getMutationType()
        : diff.mergedSchema.getQueryType()
      const returnTypeName = getNamedTypeName(rootType?.getFields()[fieldName]?.type)

      if (
        returnTypeName &&
        subtreeHasNewField(selection.selectionSet, returnTypeName, diff.mergedSchema, diff.liveFields, fragments)
      ) {
        const { live, mock } = splitSelectionSet(
          selection.selectionSet,
          returnTypeName,
          diff.mergedSchema,
          diff.liveFields,
          fragments
        )
        splitRootFields.push({ fieldName, liveSelections: live, mockSelections: mock })
        continue
      }
    }

    liveRootFields.push(fieldName)
  }

  return { liveRootFields, mockRootFields, splitRootFields }
}

// Prune a document to only the specified root fields + their referenced fragments
export function pruneDocument(
  document: DocumentNode,
  rootFieldNames: string[],
  operationName?: string | null
): DocumentNode {
  const keep = new Set(rootFieldNames)
  const usedFragments = new Set<string>()

  const prunedDefs = document.definitions.map((def) => {
    if (
      def.kind !== Kind.OPERATION_DEFINITION ||
      (operationName && def.name?.value !== operationName)
    ) {
      return def
    }

    const keptSelections = def.selectionSet.selections.filter(
      (sel) => sel.kind !== Kind.FIELD || keep.has(sel.name.value)
    )

    collectUsedFragments(
      { ...def.selectionSet, selections: keptSelections as any },
      document,
      usedFragments
    )

    return { ...def, selectionSet: { ...def.selectionSet, selections: keptSelections } }
  })

  const filteredDefs = prunedDefs.filter(
    (def) => def.kind !== Kind.FRAGMENT_DEFINITION || usedFragments.has(def.name.value)
  )

  return { ...document, definitions: filteredDefs as any }
}

// Build a document containing only a single root field with the given selections substituted in
export function buildDocumentForSplitField(
  document: DocumentNode,
  fieldName: string,
  selections: SelectionNode[],
  operationName?: string | null
): DocumentNode {
  const usedFragments = new Set<string>()
  const fakeSelectionSet: SelectionSetNode = { kind: Kind.SELECTION_SET, selections }
  collectUsedFragments(fakeSelectionSet, document, usedFragments)

  const prunedDefs = document.definitions.map((def) => {
    if (
      def.kind !== Kind.OPERATION_DEFINITION ||
      (operationName && def.name?.value !== operationName)
    ) {
      return def
    }

    const rootField = def.selectionSet.selections.find(
      (sel): sel is FieldNode => sel.kind === Kind.FIELD && sel.name.value === fieldName
    )
    if (!rootField) return def

    const newRootField: FieldNode = {
      ...rootField,
      selectionSet: fakeSelectionSet,
    }

    return {
      ...def,
      selectionSet: { ...def.selectionSet, selections: [newRootField] },
    }
  })

  const filteredDefs = prunedDefs.filter(
    (def) => def.kind !== Kind.FRAGMENT_DEFINITION || usedFragments.has((def as FragmentDefinitionNode).name.value)
  )

  return { ...document, definitions: filteredDefs as any }
}

function collectUsedFragments(
  selectionSet: SelectionSetNode,
  document: DocumentNode,
  collected: Set<string>
): void {
  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.FRAGMENT_SPREAD && !collected.has(sel.name.value)) {
      collected.add(sel.name.value)
      const frag = document.definitions.find(
        (d): d is FragmentDefinitionNode =>
          d.kind === Kind.FRAGMENT_DEFINITION && d.name.value === sel.name.value
      )
      if (frag) collectUsedFragments(frag.selectionSet, document, collected)
    } else if (sel.kind === Kind.FIELD && sel.selectionSet) {
      collectUsedFragments(sel.selectionSet, document, collected)
    } else if (sel.kind === Kind.INLINE_FRAGMENT && sel.selectionSet) {
      collectUsedFragments(sel.selectionSet, document, collected)
    }
  }
}

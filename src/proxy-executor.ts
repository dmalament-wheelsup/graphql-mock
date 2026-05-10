import { print, GraphQLError, type DocumentNode, type ExecutionResult } from 'graphql'
import { pruneDocument } from './request-analyzer'

const HOP_BY_HOP = new Set(['host', 'content-length', 'transfer-encoding', 'connection'])
const FORWARD_PREFIXES = ['authorization', 'cookie', 'x-']

function buildForwardHeaders(incoming: Headers): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  for (const [key, value] of incoming.entries()) {
    const lower = key.toLowerCase()
    if (!HOP_BY_HOP.has(lower) && FORWARD_PREFIXES.some((p) => lower.startsWith(p))) {
      headers[lower] = value
    }
  }
  return headers
}

export async function executeProxy(
  document: DocumentNode,
  variables: Record<string, unknown>,
  operationName: string | null | undefined,
  rootFieldNames: string[],
  incomingHeaders: Headers,
  endpointUrl: string
): Promise<ExecutionResult> {
  const pruned = pruneDocument(document, rootFieldNames, operationName)
  const query = print(pruned)

  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: buildForwardHeaders(incomingHeaders),
      body: JSON.stringify({ query, variables, operationName }),
    })
    return (await res.json()) as ExecutionResult
  } catch (err) {
    return {
      data: null,
      errors: [new GraphQLError(`Proxy error: ${(err as Error).message}`)],
    }
  }
}

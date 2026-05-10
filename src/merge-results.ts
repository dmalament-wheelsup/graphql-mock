import type { ExecutionResult } from 'graphql'

// Deep merge two data values. Proxy wins on scalar conflicts.
// Arrays are zipped by index; objects are merged recursively.
export function deepMergeData(proxy: unknown, mock: unknown): unknown {
  if (Array.isArray(proxy) && Array.isArray(mock)) {
    const len = Math.max(proxy.length, mock.length)
    return Array.from({ length: len }, (_, i) => deepMergeData(proxy[i], mock[i]))
  }
  if (isPlainObject(proxy) && isPlainObject(mock)) {
    const result: Record<string, unknown> = { ...(proxy as Record<string, unknown>) }
    for (const [key, mockVal] of Object.entries(mock as Record<string, unknown>)) {
      result[key] = key in result ? deepMergeData(result[key], mockVal) : mockVal
    }
    return result
  }
  // Proxy value wins; fall back to mock if proxy is null/undefined
  return proxy ?? mock
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

export function mergeResults(
  proxyResult: ExecutionResult | null,
  mockResult: ExecutionResult | null
): ExecutionResult {
  const data = Object.assign({}, proxyResult?.data ?? {}, mockResult?.data ?? {})
  const errors = [...(proxyResult?.errors ?? []), ...(mockResult?.errors ?? [])]
  return errors.length > 0 ? { data, errors } : { data }
}

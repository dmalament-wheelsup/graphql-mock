import { Command } from 'commander'
import chokidar from 'chokidar'
import { resolve } from 'path'
import { buildSchemaDiff } from './schema-diff'
import { buildMockSchema, type Generators } from './mock-executor'
import { createDevServer, type ProxyState } from './server'

const program = new Command()
  .name('graphql-mock')
  .description('GraphQL dev server — proxies live fields, mocks new/overridden ones')
  .requiredOption('-s, --schema <path>', 'Path to local GraphQL extensions SDL file')
  .requiredOption('-e, --endpoint <url>', 'Live GraphQL endpoint URL')
  .option('-p, --port <number>', 'Port to listen on', '4000')
  .option('-w, --watch', 'Reload schema file on change without restarting the server')
  .option('-d, --delay <ms>', 'Minimum response time in ms for mocked fields (proxy latency counts toward this)', '0')
  .option('-g, --generators <path>', 'Path to a JS/TS file exporting custom mock generator functions')
  .option('-H, --header <header>', 'Header to forward to the live endpoint (repeatable, e.g. "Authorization: Bearer token")', collect, [])
  .parse(process.argv)

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

function parseHeaders(raw: string[]): Record<string, string> {
  return Object.fromEntries(
    raw.map((h) => {
      const colon = h.indexOf(':')
      if (colon === -1) throw new Error(`Invalid header (expected "Name: Value"): ${h}`)
      return [h.slice(0, colon).trim().toLowerCase(), h.slice(colon + 1).trim()]
    })
  )
}

const opts = program.opts<{
  schema: string
  endpoint: string
  port: string
  watch?: boolean
  delay: string
  generators?: string
  header: string[]
}>()

function loadGenerators(generatorsPath: string): Generators {
  const mod = require(resolve(generatorsPath))
  return mod.default ?? mod
}

async function buildProxyState(
  schemaPath: string,
  endpointUrl: string,
  headers: Record<string, string>,
  generators: Generators
): Promise<ProxyState> {
  console.log('[graphql-mock] Introspecting live schema…')
  const customScalarNames = Object.keys(generators).filter((k) => k[0] === k[0].toLowerCase())
  const diff = await buildSchemaDiff(schemaPath, endpointUrl, headers, customScalarNames)
  const mockSchema = buildMockSchema(diff.mergedSchema, generators)

  if (diff.newRootFields.size > 0) {
    console.log(`[graphql-mock] Mocking ${diff.newRootFields.size} new root field(s): ${[...diff.newRootFields].join(', ')}`)
  }
  if (diff.overriddenFields.size > 0) {
    console.log(`[graphql-mock] Mocking ${diff.overriddenFields.size} overridden field(s): ${[...diff.overriddenFields].join(', ')}`)
  }

  return { diff, mockSchema, endpointUrl }
}

async function main(): Promise<void> {
  const port = parseInt(opts.port, 10)
  const minDelayMs = parseInt(opts.delay, 10)
  const headers = parseHeaders(opts.header)

  let generators: Generators = {}
  if (opts.generators) {
    try {
      generators = loadGenerators(opts.generators)
    } catch (err) {
      console.error('[graphql-mock] Failed to load generators file:', (err as Error).message)
      process.exit(1)
    }
  }

  let state: ProxyState
  try {
    state = await buildProxyState(opts.schema, opts.endpoint, headers, generators)
  } catch (err) {
    console.error('[graphql-mock] Startup failed:', (err as Error).message)
    process.exit(1)
  }

  const stateRef = { current: state }
  const server = createDevServer(stateRef, port, minDelayMs)

  server.listen(port, () => {
    console.log(`[graphql-mock] GraphQL endpoint → http://localhost:${port}/graphql`)
    console.log(`[graphql-mock] Apollo Sandbox   → http://localhost:${port}/`)
  })

  if (opts.watch) {
    chokidar.watch(opts.schema, { ignoreInitial: true }).on('change', async () => {
      console.log('[graphql-mock] Schema file changed, reloading…')
      try {
        stateRef.current = await buildProxyState(opts.schema, opts.endpoint, headers, generators)
        console.log('[graphql-mock] Reloaded successfully')
      } catch (err) {
        console.error('[graphql-mock] Reload failed, keeping previous state:', (err as Error).message)
      }
    })
  }
}

main()

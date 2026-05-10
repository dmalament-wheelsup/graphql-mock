# Reference

Complete reference for `graphql-mock` — every flag, every directive argument, every internal. For an introduction and quick-start, see the [README](../README.md).

## Contents

- [CLI](#cli)
- [Writing the extensions file](#writing-the-extensions-file)
- [Directives](#directives)
  - [`@fake`](#fake)
  - [`@listSize`](#listsize)
  - [`@error`](#error)
  - [Scalar defaults](#scalar-defaults)
  - [Determinism](#determinism)
- [Custom generators](#custom-generators)
- [Header forwarding](#header-forwarding)
- [Simulated latency](#simulated-latency)
- [Watch mode](#watch-mode)
- [Codegen integration](#codegen-integration)
- [Architecture](#architecture)
- [Error handling](#error-handling)
- [Requirements](#requirements)

---

## CLI

```
graphql-mock --schema <path> --endpoint <url> [options]
```

| Flag | Short | Required | Default | Description |
|------|-------|----------|---------|-------------|
| `--schema <path>` | `-s` | yes | — | Path to local GraphQL extensions SDL file |
| `--endpoint <url>` | `-e` | yes | — | Live GraphQL endpoint URL |
| `--port <number>` | `-p` | no | `4000` | Port to listen on |
| `--watch` | `-w` | no | off | Reload schema file on change without restarting |
| `--delay <ms>` | `-d` | no | `0` | Minimum response time in ms for requests with mocked fields |
| `--generators <path>` | `-g` | no | — | Path to a JS/TS file exporting custom mock generator functions |
| `--header <header>` | `-H` | no | — | Header to forward to live endpoint (repeatable) |

### Examples

```bash
# Basic usage
graphql-mock --schema ./additions.graphql --endpoint https://api.example.com/graphql

# Custom port + watch mode
graphql-mock -s ./additions.graphql -e https://api.example.com/graphql -p 5000 -w

# Forward auth headers to the live backend
graphql-mock \
  -s ./additions.graphql \
  -e https://api.example.com/graphql \
  -H "Authorization: Bearer <token>" \
  -H "x-tenant-id: acme"
```

### URLs

Once running:

| URL | Purpose |
|-----|---------|
| `http://localhost:4000/graphql` | GraphQL endpoint |
| `http://localhost:4000/` | Apollo Sandbox (interactive explorer) |

### Installation (alternative to `npx`)

```bash
npm install        # install dependencies
npm run build      # compile TypeScript → dist/
```

Or run directly without building:

```bash
npm run dev -- --schema ./schema.graphql --endpoint https://api.example.com/graphql
```

---

## Writing the extensions file

The extensions file contains **only** the new types and fields you want to add or override. Use standard GraphQL SDL `extend type` syntax.

```graphql
# additions.graphql

extend type Query {
  recommendations: [Recommendation!]!
  featuredProduct: Product
}

type Recommendation {
  id: ID!
  productName: String! @fake(type: productName)
  score: Float!
  reviewedBy: String! @fake(type: fullName)
  createdAt: String! @fake(type: pastDate)
}
```

You can also **override an existing live field** by re-declaring it. The server will strip the field from the live schema and route it through the mock executor instead.

---

## Directives

The `@fake`, `@listSize`, and `@error` directives (plus the `FakeType` enum) are injected into the merged schema automatically — no need to define them yourself.

### `@fake`

Annotate any field with `@fake` to control what kind of realistic data it generates. Use `type` for generic Falso-backed data, or `oneOf` to pick randomly from a fixed list of domain-specific values:

```graphql
type Store {
  currencyCode: String! @fake(oneOf: ["USD", "EUR", "GBP", "JPY", "CAD"])
  isoCountry: String!   @fake(oneOf: ["US", "CA", "GB", "DE", "FR"])
  name: String!         @fake(type: companyName)
}

type Product {
  id: ID!
  name: String!         @fake(type: productName)
  price: Float!         @fake(type: price)
  seller: String!       @fake(type: companyName)
  description: String!  @fake(type: paragraph)
  listedAt: String!     @fake(type: pastDate)
}
```

`oneOf` accepts **string values only** and is intended for `String` fields. It is not supported on `Int`, `Float`, `Boolean`, or custom scalar fields — use `@fake(type: ...)` for those. It is ideal for any string field where you know the valid value space: airport codes, currency codes, status strings, country codes, etc.

#### `FakeType` values

| FakeType | Example output |
|----------|---------------|
| `firstName` | `"Lena"` |
| `lastName` | `"Hoffman"` |
| `fullName` | `"Lena Hoffman"` |
| `email` | `"lena.hoffman@example.com"` |
| `url` | `"https://example.com/path"` |
| `uuid` | `"4b9e1c3a-..."` |
| `phoneNumber` | `"+1-555-0123"` |
| `streetAddress` | `"742 Evergreen Terrace"` |
| `city` | `"Springfield"` |
| `country` | `"United States"` |
| `zipCode` | `"90210"` |
| `companyName` | `"Acme Corp"` |
| `jobTitle` | `"Senior Engineer"` |
| `productName` | `"Wireless Headphones Pro"` |
| `sentence` | `"The quick brown fox jumps."` |
| `paragraph` | `"Lorem ipsum..."` |
| `pastDate` | `"2024-11-03T14:22:00.000Z"` |
| `futureDate` | `"2026-08-17T09:00:00.000Z"` |
| `price` | `49.99` |
| `word` | `"falcon"` |
| `boolean` | `true` |
| `number` | `742` |

### `@listSize`

By default, list fields return 2 mock items. Use `@listSize` to control the length:

```graphql
type Query {
  # Exact count
  topProducts: [Product!]! @listSize(count: 10)

  # Random count in range
  recommendations: [Recommendation!]! @listSize(min: 3, max: 12)
}
```

| Argument | Type | Description |
|----------|------|-------------|
| `count` | `Int` | Exact number of items |
| `min` | `Int` | Minimum items (default: `1`) |
| `max` | `Int` | Maximum items (default: `10`) |

`count` takes precedence over `min`/`max` if both are provided. If only `min` or only `max` is given, the other defaults to `1` or `10` respectively.

### `@error`

Annotate a field with `@error` to make it return a GraphQL error instead of data. The field will be `null` in `data` and an entry will appear in the top-level `errors` array — matching the format returned by real backends.

```graphql
extend type Query {
  searchMembers(query: String!): [Member] @error
  recommendations: [Recommendation!]! @error(
    message: "Service temporarily unavailable"
    code: "DOWNSTREAM_SERVICE_ERROR"
    classification: "BAD_REQUEST"
    serviceName: "recommendation-service"
    statusCode: 500
  )
}
```

All arguments are optional and default to realistic values:

| Argument | Default |
|----------|---------|
| `message` | `"Unable to process your request at this moment. Please check your information and try again."` |
| `code` | `"DOWNSTREAM_SERVICE_ERROR"` |
| `classification` | `"BAD_REQUEST"` |
| `serviceName` | _(omitted)_ |
| `statusCode` | `200` |

The `path` and `locations` fields in the error are populated automatically by the GraphQL execution engine. Example response:

```json
{
  "errors": [
    {
      "message": "Unable to process your request at this moment. Please check your information and try again.",
      "locations": [{ "line": 1, "column": 33 }],
      "path": ["searchMembers"],
      "extensions": {
        "classification": "BAD_REQUEST",
        "code": "DOWNSTREAM_SERVICE_ERROR",
        "statusCode": 200
      }
    }
  ],
  "data": {
    "searchMembers": null
  }
}
```

### Scalar defaults

Fields without `@fake` fall back to these scalar defaults:

| GraphQL scalar | Generated value |
|----------------|----------------|
| `ID` | random UUID |
| `String` | random word |
| `Int` | random integer 1–1000 |
| `Float` | random float 0–1000 |
| `Boolean` | random boolean |

List fields are automatically wrapped in arrays (2 items by default, courtesy of `@graphql-tools/mock`).

### Determinism

Mock data is seeded with a fixed value on every request, so the same query always returns the same values. This keeps UI stable across page loads and navigations — no flickering values or layout shifts caused by changing data. Items within a list still look different from each other since they draw consecutive values from the seeded sequence.

---

## Custom generators

Pass `--generators <path>` to extend the mock system with your own data generation functions. The file can be TypeScript or JavaScript and should export a plain object mapping names to generator functions.

```bash
graphql-mock -s ./additions.graphql -e https://api.example.com/graphql -g ./generators.ts
```

```ts
// generators.ts
import { randWord } from '@ngneat/falso'

export default {
  // Uppercase key = type generator
  // Used automatically whenever any mocked field returns this GraphQL type.
  Sku: () => ({
    skuCode: `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
    name: 'Wireless Headphones Pro',
    category: 'Electronics',
    inStock: true,
  }),

  // Lowercase key = scalar generator
  // Becomes available as @fake(type: skuCode) in your extensions SDL.
  skuCode: () => `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
}
```

### Type generators (uppercase key)

A type generator is keyed by a GraphQL type name (e.g. `Sku`). It returns an object with field values for that type. Whenever a mocked field resolves to that type — anywhere in the subtree of a mocked query — the generator is used instead of the default field-by-field scalar mocking.

Type generators only affect mock execution. Queries that are proxied to the live backend return real data regardless.

### Scalar generators (lowercase key)

A scalar generator is keyed by an arbitrary camelCase name and returns a single value. Once registered, the name becomes available as a `FakeType` value and can be used with `@fake(type: ...)` anywhere in your extensions SDL:

```graphql
type OrderItem {
  skuCode: String! @fake(type: skuCode)
  product: Sku
  quantity: Int!
}
```

You can import from any library — Falso, Faker, a hardcoded lookup table, or your own logic. Since `ts-node` is already a dev dependency, TypeScript generators work without any extra build step.

### Adding generators to the source (forks only)

The preferred way to add custom generators is via the `--generators` flag, which requires no changes to the source code. If you have forked the project and want to add generators directly to the source, edit `src/falso-mocks.ts` in three places:

**1. Add the type name to the `FakeType` union:**

```ts
export type FakeType =
  | 'firstName'
  | ...
  | 'skuCode'   // ← add here
```

**2. Add a generator to `fakeTypeGenerators`:**

```ts
export const fakeTypeGenerators: Record<FakeType, () => unknown> = {
  ...
  skuCode: () => `SKU-${Math.floor(1000 + Math.random() * 9000)}`,  // ← add here
}
```

The function can return anything — call another Falso helper, use `Math.random()`, pull from a hardcoded list, etc.

**3. Add the value to the `FakeType` enum in `FAKE_DIRECTIVE_SDL`:**

```ts
export const FAKE_DIRECTIVE_SDL = `
  enum FakeType {
    ...
    skuCode
  }
  ...
`
```

After rebuilding (`npm run build`), you can use the new type in your extensions file:

```graphql
type OrderItem {
  id: ID!
  skuCode: String! @fake(type: skuCode)
}
```

---

## Header forwarding

The `--header` flag lets you inject static headers into every proxied request:

```bash
graphql-mock \
  -s ./additions.graphql \
  -e https://api.example.com/graphql \
  -H "Authorization: Bearer eyJ..."
```

The flag is repeatable — pass it multiple times for multiple headers. Headers are forwarded only to the live backend; mock requests are local.

In addition, `Authorization`, `Cookie`, and all `x-*` headers from the **incoming browser request** are forwarded to the live backend automatically. Hop-by-hop headers (`Host`, `Content-Length`, `Transfer-Encoding`) are stripped.

---

## Simulated latency

Pass `--delay <ms>` to set a minimum response time for any request that includes mocked fields. This lets you test loading states and skeleton UIs under realistic network conditions.

```bash
graphql-mock -s ./additions.graphql -e https://api.example.com/graphql --delay 800
```

The delay is **smart about mixed requests**. Because the proxy and mock executors run in parallel, any latency from the live backend already counts toward the minimum — only the remaining time is added. This means you won't artificially slow down requests that were already slow.

| Scenario | Behavior |
|----------|----------|
| All mocked, no proxy | Full delay is applied |
| Mixed (proxy + mock) | Proxy latency counts; only the gap is added |
| All proxied, nothing mocked | Delay is not applied |

For example, with `--delay 1000`: if the proxy responds in 700ms, only 300ms is added. If the proxy takes 1200ms, no delay is added at all.

---

## Watch mode

Pass `--watch` (or `-w`) to reload the extensions file whenever it changes on disk, without restarting the server or losing the HTTP connection:

```bash
graphql-mock -s ./additions.graphql -e https://api.example.com/graphql --watch
```

If the reloaded SDL is invalid, the server logs the error and keeps the last valid state.

---

## Codegen integration

Because the server serves full introspection against the merged schema, you can point `graphql-codegen` directly at the local endpoint:

```yaml
# codegen.yml
schema: http://localhost:4000/graphql
documents: ./src/**/*.graphql
generates:
  ./src/generated/types.ts:
    plugins:
      - typescript
      - typescript-operations
```

Run `graphql-codegen` while the dev proxy is running to generate types that include both live and in-progress fields.

---

## Architecture

```
src/
├── cli.ts               # Arg parsing, server startup, watch mode
├── server.ts            # GraphQL Yoga server + ProxyState + execute plugin
├── schema-diff.ts       # Introspect live backend, merge extensions, build liveFields set
├── request-analyzer.ts  # AST walk to classify root fields as proxy vs mock
├── proxy-executor.ts    # Forwards pruned requests to live backend
├── mock-executor.ts     # addMocksToSchema + execute against mock schema
├── falso-mocks.ts       # Falso-backed IMocks + @fake directive SDL
└── merge-results.ts     # Combine proxy + mock ExecutionResults
```

### Schema diff

`schema-diff.ts` builds the routing table at startup (and on each watch reload):

1. Introspect the live endpoint → `liveSchema`
2. Build `liveFields: Set<string>` — keys like `"Query.user"`, `"User.email"`
3. Parse the local extensions SDL
4. If any extension field already exists on the live schema, strip it from `liveSchema` first so there is no conflict, then remove it from `liveFields` so it routes to the mock executor
5. Merge extensions onto the pruned `liveSchema` → `mergedSchema`
6. Inject `@fake` directive + `FakeType` enum into `mergedSchema`

### Request routing (per root field)

For each root field in the incoming document:

- Walk the entire subtree with `TypeInfo` + `visitWithTypeInfo`
- If **every** field in the subtree is in `liveFields` → proxy
- If **any** field in the subtree is missing from `liveFields` → mock

This conservative routing prevents sending partially-valid selections to the live backend.

### Parallel execution

```ts
Promise.all([
  executeProxy(document, liveRootFields, ...),
  executeMock(mockSchema, document, mockRootFields, ...),
])
→ mergeResults(proxyResult, mockResult)
// Object.assign({}, proxyResult.data, mockResult.data)
// safe because root field sets are always disjoint
```

---

## Error handling

| Scenario | Behavior |
|----------|----------|
| Live backend unreachable | Returns `{ errors: [{ message: "Proxy error: ..." }] }`, mock fields still resolve |
| Invalid SDL on startup | Exits with a clear error message |
| Invalid SDL on watch reload | Logs error, keeps last valid state |
| Introspection disabled on live backend | Clear error message on startup |
| Subscriptions | Returns an unsupported error (out of scope for v1) |

---

## Requirements

- Node.js ≥ 18
- A live GraphQL endpoint that supports introspection

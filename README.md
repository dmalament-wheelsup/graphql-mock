<div align="center">

# `> graphql-mock`

### Stop waiting on backend. Run codegen today against the schema that ships tomorrow.

A dev-time GraphQL server that **proxies live fields to a real backend** and **mocks new or overridden fields** with realistic fake data — exposed as a single unified GraphQL endpoint that codegen, your client, and Apollo Sandbox can talk to.

[![Node](https://img.shields.io/badge/node-%E2%89%A518-3fb950?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![GraphQL Yoga](https://img.shields.io/badge/GraphQL_Yoga-d2a8ff?style=flat-square&logo=graphql&logoColor=white)](https://the-guild.dev/graphql/yoga-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-ffa657?style=flat-square)](LICENSE)

`Proxy` · `Mock` · `Codegen` · `React Query`

[**Quick Start**](#-quick-start) · [**How It Works**](#-how-it-works) · [**Features**](#-features) · [**Reference docs →**](docs/REFERENCE.md)

</div>

---

## The Problem

Your frontend pipeline is tightly integrated. `graphql-codegen` introspects the schema, generates TypeScript types and React Query hooks, your components consume those hooks. **The whole chain depends on the schema existing on a real server.**

So when backend hasn't shipped yet:

| You can't… | Workaround | Why it sucks |
|---|---|---|
| Run codegen | Hand-write types | They drift, then break on deploy |
| Generate hooks | Mock the entire API | Lose real data for existing fields |
| Build the UI | Wait for backend | Teams serialize instead of parallelizing |

## The Solution

`graphql-mock` sits between your app and the real API. It introspects the live endpoint, merges your local SDL extensions, and serves a **unified schema** on `:4000`. For each request it routes live fields to the real API, new fields to the mock engine, and deep-merges the results.

```
                          ┌──────────────────┐         ┌──────────────┐
   Your App  ─────────►   │   graphql-mock   │  ──┬──► │   Live API   │
   (Apollo, Relay,        │  :4000/graphql   │    │    │ Real backend │
    urql, codegen)        │                  │    │    └──────────────┘
                          │  • introspect    │    │
                          │  • merge SDL     │    │    ┌──────────────┐
                          │  • route + merge │    └──► │ Mock Engine  │
                          └──────────────────┘         │  @fake / SDL │
                                                       └──────────────┘
```

> **The key insight:** `graphql-mock` exposes a *real* GraphQL endpoint with the merged schema. `graphql-codegen` introspects it like any production API and generates real TS types and React Query hooks. **When backend ships, the generated code you already checked in just works at runtime — no re-codegen needed.**

---

## ⚡ Quick Start

```bash
npx graphql-mock \
  --schema ./extensions.graphql \
  --endpoint https://api.example.com/graphql \
  --watch
```

That's it. You now have:

| URL | Purpose |
|-----|---------|
| `http://localhost:4000/graphql` | GraphQL endpoint (point your client/codegen here) |
| `http://localhost:4000/` | Apollo Sandbox — explore the merged schema interactively |

Then point `graphql-codegen` at `http://localhost:4000/graphql` and generate types as usual:

```ts
// codegen.ts
import { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: 'http://localhost:4000/graphql',     // ← graphql-mock
  documents: 'src/**/*.graphql',
  generates: {
    'src/generated/graphql.ts': {
      plugins: ['typescript', 'typescript-operations', 'typescript-react-query'],
    },
  },
}
export default config
```

A minimal `extensions.graphql`:

```graphql
type Recommendation {
  id: ID!
  productName: String! @fake(type: productName)
  score: Float!
  reviewedBy: String!  @fake(type: fullName)
  createdAt: String!   @fake(type: pastDate)
}

extend type Query {
  recommendations: [Recommendation!]! @listSize(min: 3, max: 12)
}
```

→ See the [reference docs](docs/REFERENCE.md) for every flag, every directive argument, and every internal.

---

## ✨ Features

| | | |
|---|---|---|
| 🔀 **Smart routing** | 🎭 **Realistic mocks** | 🔥 **Hot reload** |
| Per-field classification: live → proxy, new → mock. Even within the same query. | 22+ built-in `@fake` types: names, emails, dates, prices, addresses. Plus `oneOf`. | `--watch` reloads SDL on save. No restart, no dropped connections. |
| 📐 **List control** | 💥 **Error simulation** | ⏱️ **Latency simulation** |
| `@listSize(count: 10)` or `@listSize(min: 3, max: 12)` for any list field. | `@error(...)` returns proper GraphQL errors with `code`, `classification`, `statusCode`. | `--delay 500` for realistic load states. Smart about mixed proxy/mock requests. |
| 🧬 **Custom generators** | 🪄 **Field overrides** | 🔌 **Header forwarding** |
| `--generators ./gen.ts` plugs in domain-specific factories (e.g. `Sku`, `Order`). | Re-declare a live field in your SDL to mock it instead. Great for testing edge cases. | `Authorization`, `Cookie`, and `x-*` headers pass through automatically. |
| 🧩 **Apollo Sandbox** | 📊 **Full introspection** | 🎯 **Deterministic** |
| Built-in IDE at `localhost:4000/`. Explore, run queries, read docs. | Clients see one unified API — they can't tell which fields are real vs mocked. | Same query → same data on every request. No flicker, no layout shift. |

---

## 🔬 How It Works

A single query touching both live and new fields is automatically split:

```graphql
query {
  order(id: "123") {              # live root
    status                         # → proxy
    customer { name }              # → proxy
    loyalty {                      # → mock (new field on live type)
      tier
      perks { name }
    }
  }
  recommendations(userId: "u9") {  # entirely new root → mock
    productName
  }
}
```

The proxy gets a pruned query without `loyalty`, the mock gets only the new fields, both run via `Promise.all`, and the results are merged: arrays zipped by index, objects merged recursively, **proxy wins on conflicts**.

```
                    incoming request
                          │
                  analyzeRequest()  ──  AST walk with TypeInfo
                          │
            ┌─────────────┴─────────────┐
            │                           │
    only live fields?            any mocked field?
            │                           │
            ▼                           ▼
      proxy executor              mock executor
            │                           │
            └─────────────┬─────────────┘
                          ▼
                   deep merge results
                          │
                          ▼
                       response
```

For the routing algorithm, schema-diff steps, and parallel execution details, see [Architecture](docs/REFERENCE.md#architecture).

---

## 🎨 A Taste of the Directives

```graphql
type Product {
  name: String!         @fake(type: productName)
  price: Float!         @fake(type: price)
  description: String!  @fake(type: paragraph)
  status: String!       @fake(oneOf: ["active", "draft", "archived"])
}

extend type Query {
  topProducts: [Product!]! @listSize(count: 10)

  paymentStatus(id: ID!): PaymentStatus @error(
    message: "Payment service unavailable"
    code: "SERVICE_UNAVAILABLE"
    statusCode: 503
  )
}
```

Three directives, all auto-injected into the merged schema:

- **`@fake`** — `type:` for one of 22+ built-in generators, or `oneOf:` for a fixed list
- **`@listSize`** — `count:` for exact, or `min:`/`max:` for a range
- **`@error`** — return a proper GraphQL error with `message`, `code`, `classification`, `serviceName`, `statusCode`

→ Full directive reference: [docs/REFERENCE.md#directives](docs/REFERENCE.md#directives)

---

## 📚 Documentation

Everything else lives in the **[Reference docs](docs/REFERENCE.md)**:

- [CLI flags](docs/REFERENCE.md#cli) — every option, every default, examples
- [Writing the extensions file](docs/REFERENCE.md#writing-the-extensions-file)
- [Directives](docs/REFERENCE.md#directives) — full `@fake` / `@listSize` / `@error` reference, including the complete `FakeType` table
- [Custom generators](docs/REFERENCE.md#custom-generators) — type generators, scalar generators, source forking
- [Header forwarding](docs/REFERENCE.md#header-forwarding) — auto-forwarded headers, the `--header` flag
- [Simulated latency](docs/REFERENCE.md#simulated-latency) — how `--delay` interacts with mixed requests
- [Codegen integration](docs/REFERENCE.md#codegen-integration)
- [Architecture](docs/REFERENCE.md#architecture) — schema diff, request routing, parallel execution
- [Error handling](docs/REFERENCE.md#error-handling)

---

## 📋 Requirements

- Node.js ≥ 18
- A live GraphQL endpoint that supports introspection

---

<div align="center">

### Built with

`GraphQL Yoga` · `@graphql-tools/mock` · `@ngneat/falso` · `TypeScript`

**Stop waiting on backend. Run codegen today against the schema that ships tomorrow.**

</div>

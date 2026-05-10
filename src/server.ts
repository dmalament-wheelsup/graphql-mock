import { createYoga, type Plugin } from 'graphql-yoga';
import { createServer as createHttpServer, type Server } from 'http';
import { Kind, type GraphQLSchema, type DocumentNode } from 'graphql';
import { analyzeRequest, buildDocumentForSplitField } from './request-analyzer';
import { executeProxy } from './proxy-executor';
import { executeMock } from './mock-executor';
import { mergeResults, deepMergeData } from './merge-results';
import type { SchemaDiff } from './schema-diff';

export interface ProxyState {
  diff: SchemaDiff;
  mockSchema: GraphQLSchema;
  endpointUrl: string;
}

function apolloSandboxHtml(endpoint: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>GraphQL Mock</title></head>
<body style="margin:0;overflow:hidden">
<div id="sandbox" style="width:100vw;height:100vh"></div>
<script src="https://embeddable-sandbox.cdn.apollographql.com/v2/embeddable-sandbox.umd.production.min.js"></script>
<script>
  new window.EmbeddedSandbox({
    target: '#sandbox',
    initialEndpoint: '${endpoint}',
  });
</script>
</body>
</html>`;
}

function isIntrospectionDocument(document: DocumentNode): boolean {
  return document.definitions.every(
    (def) =>
      def.kind !== Kind.OPERATION_DEFINITION ||
      def.selectionSet.selections.every(
        (sel) => sel.kind === Kind.FIELD && sel.name.value.startsWith('__'),
      ),
  );
}

function createProxyMockPlugin(
  stateRef: { current: ProxyState },
  minDelayMs: number,
): Plugin {
  return {
    onExecute({ args, setExecuteFn }) {
      // Let Yoga handle introspection natively against the merged schema
      if (isIntrospectionDocument(args.document)) return;
      setExecuteFn(async (executionArgs) => {
        const { diff, mockSchema, endpointUrl } = stateRef.current;
        const variables = (executionArgs.variableValues ?? {}) as Record<
          string,
          unknown
        >;
        const operationName = executionArgs.operationName ?? null;
        const request = (executionArgs.contextValue as any).request as Request;

        const { liveRootFields, mockRootFields, splitRootFields } = analyzeRequest(
          executionArgs.document,
          diff,
          operationName,
        );

        const start = Date.now();

        // For split fields, run proxy and mock in parallel for each field
        const splitResults = await Promise.all(
          splitRootFields.map(async ({ fieldName, liveSelections, mockSelections }) => {
            const liveDoc = buildDocumentForSplitField(executionArgs.document, fieldName, liveSelections, operationName)
            const mockDoc = buildDocumentForSplitField(executionArgs.document, fieldName, mockSelections, operationName)
            const [proxyRes, mockRes] = await Promise.all([
              executeProxy(liveDoc, variables, operationName, [fieldName], request.headers, endpointUrl),
              executeMock(mockSchema, mockDoc, variables, operationName, [fieldName]),
            ])
            const merged = deepMergeData(proxyRes.data?.[fieldName], mockRes.data?.[fieldName])
            return {
              data: { [fieldName]: merged },
              errors: [...(proxyRes.errors ?? []), ...(mockRes.errors ?? [])],
            }
          })
        )

        const [proxyResult, mockResult] = await Promise.all([
          liveRootFields.length > 0
            ? executeProxy(
                executionArgs.document,
                variables,
                operationName,
                liveRootFields,
                request.headers,
                endpointUrl,
              )
            : null,
          mockRootFields.length > 0
            ? executeMock(
                mockSchema,
                executionArgs.document,
                variables,
                operationName,
                mockRootFields,
              )
            : null,
        ]);

        // Apply minimum delay only when at least one field was mocked.
        // Proxy latency counts toward the minimum — only top up the remainder.
        if (minDelayMs > 0 && (mockRootFields.length > 0 || splitRootFields.length > 0)) {
          const elapsed = Date.now() - start;
          const remaining = minDelayMs - elapsed;
          if (remaining > 0)
            await new Promise((resolve) => setTimeout(resolve, remaining));
        }

        const base = mergeResults(proxyResult, mockResult);
        const splitData = Object.assign({}, ...splitResults.map((r) => r.data));
        const splitErrors = splitResults.flatMap((r) => r.errors);
        const data = { ...base.data, ...splitData };
        const errors = [...(base.errors ?? []), ...splitErrors];
        return errors.length > 0 ? { data, errors } : { data };
      });
    },
  };
}

export function createDevServer(
  stateRef: { current: ProxyState },
  port: number,
  minDelayMs = 0,
): Server {
  const yoga = createYoga({
    schema: () => stateRef.current.diff.mergedSchema,
    graphiql: false,
    plugins: [createProxyMockPlugin(stateRef, minDelayMs)],
    context: ({ request }) => ({ request }),
    logging: true,
  });

  return createHttpServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
      const html = apolloSandboxHtml(`http://localhost:${port}/graphql`);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
      return;
    }
    yoga(req, res);
  });
}

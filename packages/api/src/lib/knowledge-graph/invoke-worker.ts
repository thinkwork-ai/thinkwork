export interface KnowledgeGraphThreadIngestWorkerPayload {
  runId: string;
  tenantId: string;
  threadId?: string;
  sourceKind?: "thread" | "wiki" | "brain";
  sourceRef?: string;
  requestedByUserId: string | null;
}

interface InvokeWorkerDeps {
  lambdaClient?: { send(command: any): Promise<unknown> };
  InvokeCommand?: new (input: Record<string, unknown>) => any;
  functionName?: string | null;
}

export class KnowledgeGraphWorkerInvokeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeGraphWorkerInvokeError";
  }
}

export async function invokeKnowledgeGraphThreadIngestWorker(
  payload: KnowledgeGraphThreadIngestWorkerPayload,
  deps: InvokeWorkerDeps = {},
): Promise<void> {
  const functionName = deps.functionName ?? resolveWorkerFunctionName();
  if (!functionName) {
    throw new KnowledgeGraphWorkerInvokeError(
      "Knowledge Graph ingest worker function name is not configured",
    );
  }

  const { client, InvokeCommand } = await resolveLambdaDeps(deps);
  const result = (await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  )) as {
    StatusCode?: number;
    FunctionError?: string;
    Payload?: Uint8Array | Buffer | string;
  };

  if (result.FunctionError) {
    throw new KnowledgeGraphWorkerInvokeError(
      `Knowledge Graph ingest worker failed: ${decodePayload(result.Payload)}`,
    );
  }
  if (result.StatusCode && result.StatusCode >= 300) {
    throw new KnowledgeGraphWorkerInvokeError(
      `Knowledge Graph ingest worker invoke returned HTTP ${result.StatusCode}`,
    );
  }
}

export function resolveWorkerFunctionName(): string | null {
  if (process.env.KNOWLEDGE_GRAPH_THREAD_INGEST_FUNCTION_NAME) {
    return process.env.KNOWLEDGE_GRAPH_THREAD_INGEST_FUNCTION_NAME;
  }
  if (!process.env.STAGE) return null;
  return `thinkwork-${process.env.STAGE}-api-knowledge-graph-thread-ingest`;
}

async function resolveLambdaDeps(deps: InvokeWorkerDeps) {
  if (deps.lambdaClient && deps.InvokeCommand) {
    return { client: deps.lambdaClient, InvokeCommand: deps.InvokeCommand };
  }
  const { LambdaClient, InvokeCommand } = await import(
    "@aws-sdk/client-lambda"
  );
  return {
    client: deps.lambdaClient ?? new LambdaClient({}),
    InvokeCommand: deps.InvokeCommand ?? InvokeCommand,
  };
}

function decodePayload(
  payload: Uint8Array | Buffer | string | null | undefined,
): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  return new TextDecoder().decode(payload);
}

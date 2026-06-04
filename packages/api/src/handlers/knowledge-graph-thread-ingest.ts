interface KnowledgeGraphThreadIngestEvent {
  runId?: string;
  tenantId?: string;
  threadId?: string;
}

export async function handler(event: KnowledgeGraphThreadIngestEvent) {
  if (!event.runId || !event.tenantId || !event.threadId) {
    throw new Error("runId, tenantId, and threadId are required");
  }

  return {
    accepted: true,
    runId: event.runId,
    tenantId: event.tenantId,
    threadId: event.threadId,
    message: "Knowledge Graph ingest worker accepted the run.",
  };
}

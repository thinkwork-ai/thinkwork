import { runOntologySuggestionScan } from "../lib/ontology/suggestions.js";

export interface OntologyScanEvent {
  tenantId?: string;
  jobId?: string;
}

export const handler = async (event: OntologyScanEvent) => {
  if (!event.tenantId || !event.jobId) {
    throw new Error("ontology-scan requires tenantId and jobId");
  }

  const result = await runOntologySuggestionScan({
    tenantId: event.tenantId,
    jobId: event.jobId,
  });

  return {
    statusCode: result.status === "failed" ? 500 : 200,
    body: JSON.stringify(result),
  };
};

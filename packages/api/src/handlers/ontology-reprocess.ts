import { runOntologyReprocess } from "../lib/ontology/reprocess.js";

export interface OntologyReprocessEvent {
  jobId?: string;
}

export const handler = async (event: OntologyReprocessEvent = {}) => {
  const result = await runOntologyReprocess({ jobId: event.jobId });
  return {
    statusCode: result.ok ? 200 : 500,
    body: JSON.stringify(result),
  };
};

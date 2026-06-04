import { knowledgeGraphEntities } from "./entities.query.js";
import { knowledgeGraphEntity } from "./entity.query.js";
import { knowledgeGraphGraph } from "./graph.query.js";
import { knowledgeGraphIngestRuns } from "./ingestRuns.query.js";
import { startKnowledgeGraphThreadIngest } from "./startThreadIngest.mutation.js";
import { knowledgeGraphThreadCandidates } from "./threadCandidates.query.js";

export const knowledgeGraphQueries = {
  knowledgeGraphThreadCandidates,
  knowledgeGraphIngestRuns,
  knowledgeGraphEntities,
  knowledgeGraphGraph,
  knowledgeGraphEntity,
};
export const knowledgeGraphMutations = {
  startKnowledgeGraphThreadIngest,
};

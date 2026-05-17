import { ontologyDefinitions } from "./ontologyDefinitions.query.js";
import { ontologyChangeSets } from "./ontologyChangeSets.query.js";
import { ontologySuggestionScanJob } from "./ontologySuggestionScanJob.query.js";
import { ontologyReprocessJob } from "./ontologyReprocessJob.query.js";
import { startOntologySuggestionScanMutation } from "./startOntologySuggestionScan.mutation.js";
import { updateOntologyChangeSetMutation } from "./updateOntologyChangeSet.mutation.js";
import { approveOntologyChangeSetMutation } from "./approveOntologyChangeSet.mutation.js";
import { rejectOntologyChangeSetMutation } from "./rejectOntologyChangeSet.mutation.js";
import { updateOntologyEntityTypeMutation } from "./updateOntologyEntityType.mutation.js";
import { updateOntologyRelationshipTypeMutation } from "./updateOntologyRelationshipType.mutation.js";

export const ontologyQueries = {
  ontologyDefinitions,
  ontologyChangeSets,
  ontologySuggestionScanJob,
  ontologyReprocessJob,
};

export const ontologyMutations = {
  startOntologySuggestionScan: startOntologySuggestionScanMutation,
  updateOntologyChangeSet: updateOntologyChangeSetMutation,
  approveOntologyChangeSet: approveOntologyChangeSetMutation,
  rejectOntologyChangeSet: rejectOntologyChangeSetMutation,
  updateOntologyEntityType: updateOntologyEntityTypeMutation,
  updateOntologyRelationshipType: updateOntologyRelationshipTypeMutation,
};

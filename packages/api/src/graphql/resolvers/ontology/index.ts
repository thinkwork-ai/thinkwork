import { ontologyDefinitions } from "./ontologyDefinitions.query.js";
import { ontologySchemaGraph } from "./ontologySchemaGraph.query.js";
import { ontologyChangeSets } from "./ontologyChangeSets.query.js";
import { ontologyPacks } from "./ontologyPacks.query.js";
import { ontologySuggestionScanJob } from "./ontologySuggestionScanJob.query.js";
import { ontologyReprocessJob } from "./ontologyReprocessJob.query.js";
import { startOntologySuggestionScanMutation } from "./startOntologySuggestionScan.mutation.js";
import { createOntologyChangeSetMutation } from "./createOntologyChangeSet.mutation.js";
import { installOntologyPackMutation } from "./installOntologyPack.mutation.js";
import { updateOntologyChangeSetMutation } from "./updateOntologyChangeSet.mutation.js";
import { approveOntologyChangeSetMutation } from "./approveOntologyChangeSet.mutation.js";
import { rejectOntologyChangeSetMutation } from "./rejectOntologyChangeSet.mutation.js";
import { rejectOntologyChangeSetItemMutation } from "./rejectOntologyChangeSetItem.mutation.js";
import { updateOntologyEntityTypeMutation } from "./updateOntologyEntityType.mutation.js";
import { updateOntologyRelationshipTypeMutation } from "./updateOntologyRelationshipType.mutation.js";
import { setOntologyEntityTypeIdentityRulesMutation } from "./setOntologyEntityTypeIdentityRules.mutation.js";
import { setOntologyEntityTypeSystemMapMutation } from "./setOntologyEntityTypeSystemMap.mutation.js";
import { setOntologyEntityTypeTwinFacetsMutation } from "./setOntologyEntityTypeTwinFacets.mutation.js";
import { setOntologyEntityTypePageSectionsMutation } from "./setOntologyEntityTypePageSections.mutation.js";
import { setOntologyRelationshipTypeSourceBindingMutation } from "./setOntologyRelationshipTypeSourceBinding.mutation.js";

export const ontologyQueries = {
  ontologyDefinitions,
  ontologySchemaGraph,
  ontologyPacks,
  ontologyChangeSets,
  ontologySuggestionScanJob,
  ontologyReprocessJob,
};

export const ontologyMutations = {
  startOntologySuggestionScan: startOntologySuggestionScanMutation,
  createOntologyChangeSet: createOntologyChangeSetMutation,
  installOntologyPack: installOntologyPackMutation,
  updateOntologyChangeSet: updateOntologyChangeSetMutation,
  approveOntologyChangeSet: approveOntologyChangeSetMutation,
  rejectOntologyChangeSet: rejectOntologyChangeSetMutation,
  rejectOntologyChangeSetItem: rejectOntologyChangeSetItemMutation,
  updateOntologyEntityType: updateOntologyEntityTypeMutation,
  updateOntologyRelationshipType: updateOntologyRelationshipTypeMutation,
  setOntologyEntityTypeIdentityRules:
    setOntologyEntityTypeIdentityRulesMutation,
  setOntologyEntityTypeSystemMap: setOntologyEntityTypeSystemMapMutation,
  setOntologyEntityTypeTwinFacets: setOntologyEntityTypeTwinFacetsMutation,
  setOntologyEntityTypePageSections: setOntologyEntityTypePageSectionsMutation,
  setOntologyRelationshipTypeSourceBinding:
    setOntologyRelationshipTypeSourceBindingMutation,
};

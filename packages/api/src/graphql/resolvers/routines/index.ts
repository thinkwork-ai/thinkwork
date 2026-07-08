import { createRoutine } from "./createRoutine.mutation.js";
import { planRoutineDraft } from "./planRoutineDraft.mutation.js";
import { publishRoutineVersion } from "./publishRoutineVersion.mutation.js";
import { rebuildRoutineVersion } from "./rebuildRoutineVersion.mutation.js";
import { routineDefinition } from "./routineDefinition.query.js";
import { routineRecipeCatalog } from "./routineRecipeCatalog.query.js";
import { routineSource } from "./routineSource.query.js";
import {
  routineAslVersion,
  routineExecution,
  routineExecutions,
  routineRepairEvents_,
  routineStepEvents_,
} from "./routineExecutions.query.js";
import { tenantToolInventory } from "./tenantToolInventory.query.js";
import { triggerRoutineRun } from "./triggerRoutineRun.mutation.js";
import { updateRoutineDefinition } from "./updateRoutineDefinition.mutation.js";
import { updateRoutine } from "./updateRoutine.mutation.js";

export const routineQueries = {
  routineExecution,
  routineExecutions,
  routineStepEvents: routineStepEvents_,
  routineRepairEvents: routineRepairEvents_,
  routineAslVersion,
  routineDefinition,
  routineRecipeCatalog,
  routineSource,
  tenantToolInventory,
};

// Live Step Functions mutations replace the legacy `triggers/` versions.
// triggers/index.ts must drop these from its export so the new resolvers
// win in the merged Mutation namespace.
export const routineMutations = {
  planRoutineDraft,
  createRoutine,
  publishRoutineVersion,
  rebuildRoutineVersion,
  triggerRoutineRun,
  updateRoutine,
  updateRoutineDefinition,
};

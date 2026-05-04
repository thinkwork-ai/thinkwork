import { createRoutine } from "./createRoutine.mutation.js";
import { importN8nRoutine } from "./importN8nRoutine.mutation.js";
import { planRoutineDraft } from "./planRoutineDraft.mutation.js";
import { publishRoutineVersion } from "./publishRoutineVersion.mutation.js";
import { rebuildRoutineVersion } from "./rebuildRoutineVersion.mutation.js";
import { routineDefinition } from "./routineDefinition.query.js";
import { routineRecipeCatalog } from "./routineRecipeCatalog.query.js";
import {
  routineAslVersion,
  routineExecution,
  routineExecutions,
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
  routineAslVersion,
  routineDefinition,
  routineRecipeCatalog,
  tenantToolInventory,
};

// Live Step Functions mutations replace the legacy `triggers/` versions.
// triggers/index.ts must drop these from its export so the new resolvers
// win in the merged Mutation namespace.
export const routineMutations = {
  planRoutineDraft,
  createRoutine,
  importN8nRoutine,
  publishRoutineVersion,
  rebuildRoutineVersion,
  triggerRoutineRun,
  updateRoutine,
  updateRoutineDefinition,
};

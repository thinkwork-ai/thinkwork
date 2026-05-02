import { routines_ as routines } from "./routines.query.js";
import { routine } from "./routine.query.js";
import { threadTurns_ as threadTurns } from "./threadTurns.query.js";
import { threadTurn } from "./threadTurn.query.js";
import { threadTurnEvents_ as threadTurnEvents } from "./threadTurnEvents.query.js";
import { scheduledJobs_ as scheduledJobs } from "./scheduledJobs.query.js";
import { scheduledJob } from "./scheduledJob.query.js";
import { deleteRoutine } from "./deleteRoutine.mutation.js";
import { setRoutineTrigger } from "./setRoutineTrigger.mutation.js";
import { deleteRoutineTrigger } from "./deleteRoutineTrigger.mutation.js";
import { cancelThreadTurn } from "./cancelThreadTurn.mutation.js";
import { createWakeupRequest } from "./createWakeupRequest.mutation.js";
import { createScheduledJob } from "./createScheduledJob.mutation.js";
import { queuedWakeups } from "./queuedWakeups.query.js";

// Phase B U7: createRoutine, updateRoutine, and triggerRoutineRun moved
// to resolvers/routines/ (live Step Functions flow). publishRoutineVersion
// is also there. Phase D U13/U14 mobile parity retired the deprecated
// routineRun + routineRuns query surfaces alongside their RoutineRun /
// RoutineStep types — admin (D U14) + mobile (this PR) both query
// routineExecutions now.
export const triggerQueries = { routines, routine, threadTurns, threadTurn, threadTurnEvents, scheduledJobs, scheduledJob, queuedWakeups };
export const triggerMutations = { deleteRoutine, setRoutineTrigger, deleteRoutineTrigger, cancelThreadTurn, createWakeupRequest, createScheduledJob };

// Queries
import { skillRun } from "./skillRun.query.js";
import { skillRuns } from "./skillRuns.query.js";
import { compositionFeedbackSummary } from "./compositionFeedbackSummary.query.js";

// Mutations
import { startSkillRun } from "./startSkillRun.mutation.js";
import { cancelSkillRun } from "./cancelSkillRun.mutation.js";
import { deleteRun } from "./deleteRun.mutation.js";
import { submitRunFeedback } from "./submitRunFeedback.mutation.js";

export const skillRunsQueries = {
	skillRun,
	skillRuns,
	compositionFeedbackSummary,
};

export const skillRunsMutations = {
	startSkillRun,
	cancelSkillRun,
	deleteRun,
	submitRunFeedback,
};

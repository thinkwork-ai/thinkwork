import { executeExternalTaskAction } from "./executeExternalTaskAction.mutation.js";
import { lastmileTerminals } from "./lastmileTerminals.query.js";

export const externalTaskMutations = { executeExternalTaskAction };
export const externalTaskQueries = { lastmileTerminals };

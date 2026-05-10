import { runbookCatalog } from "./runbookCatalog.query.js";
import { runbookRun } from "./runbookRun.query.js";
import { runbookRuns } from "./runbookRuns.query.js";
import { confirmRunbookRun } from "./confirmRunbookRun.mutation.js";
import { rejectRunbookRun } from "./rejectRunbookRun.mutation.js";
import { cancelRunbookRun } from "./cancelRunbookRun.mutation.js";

export const runbookQueries = {
  runbookCatalog,
  runbookRun,
  runbookRuns,
};

export const runbookMutations = {
  confirmRunbookRun,
  rejectRunbookRun,
  cancelRunbookRun,
};

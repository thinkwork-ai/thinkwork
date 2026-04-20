import { wikiPage } from "./wikiPage.query.js";
import { wikiSearch } from "./wikiSearch.query.js";
import { wikiBacklinks } from "./wikiBacklinks.query.js";
import { wikiConnectedPages } from "./wikiConnectedPages.query.js";
import { wikiCompileJobs } from "./wikiCompileJobs.query.js";
import { wikiGraph } from "./wikiGraph.query.js";
import { wikiSubgraph } from "./wikiSubgraph.query.js";
import { compileWikiNow } from "./compileWikiNow.mutation.js";
import { bootstrapJournalImport } from "./bootstrapJournalImport.mutation.js";
import { resetWikiCursor } from "./resetWikiCursor.mutation.js";

export const wikiQueries = {
	wikiPage,
	wikiSearch,
	wikiBacklinks,
	wikiConnectedPages,
	wikiCompileJobs,
	wikiGraph,
	wikiSubgraph,
};

export const wikiMutations = {
	compileWikiNow,
	bootstrapJournalImport,
	resetWikiCursor,
};

export { WikiAuthError } from "./auth.js";

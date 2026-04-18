import { wikiPage } from "./wikiPage.query.js";
import { wikiSearch } from "./wikiSearch.query.js";
import { wikiBacklinks } from "./wikiBacklinks.query.js";
import { compileWikiNow } from "./compileWikiNow.mutation.js";

export const wikiQueries = {
	wikiPage,
	wikiSearch,
	wikiBacklinks,
};

export const wikiMutations = {
	compileWikiNow,
};

export { WikiAuthError } from "./auth.js";

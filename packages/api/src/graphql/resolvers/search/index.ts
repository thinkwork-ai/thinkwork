import { search } from "./search.query.js";
import { entityDossier } from "./entityDossier.query.js";
import { searchAsk } from "./searchAsk.mutation.js";
import { searchResearch } from "./searchResearch.mutation.js";

export const searchQueries = {
  search,
  entityDossier,
};

export const searchMutations = {
  searchAsk,
  searchResearch,
};

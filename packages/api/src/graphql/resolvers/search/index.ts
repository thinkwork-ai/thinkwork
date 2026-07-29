import { search } from "./search.query.js";
import { searchAsk } from "./searchAsk.mutation.js";
import { searchResearch } from "./searchResearch.mutation.js";

export const searchQueries = {
  search,
};

export const searchMutations = {
  searchAsk,
  searchResearch,
};

import { memoryRecords } from "./memoryRecords.query.js";
import { memorySearch } from "./memorySearch.query.js";
import { memoryGraph } from "./memoryGraph.query.js";
import { deleteMemoryRecord } from "./deleteMemoryRecord.mutation.js";
import { updateMemoryRecord } from "./updateMemoryRecord.mutation.js";

export const memoryQueries = { memoryRecords, memorySearch, memoryGraph };

export const memoryMutations = { deleteMemoryRecord, updateMemoryRecord };

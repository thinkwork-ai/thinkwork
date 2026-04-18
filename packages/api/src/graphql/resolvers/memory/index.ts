import { memoryRecords } from "./memoryRecords.query.js";
import { memorySearch } from "./memorySearch.query.js";
import { memoryGraph } from "./memoryGraph.query.js";
import { memorySystemConfig } from "./memorySystemConfig.query.js";
import { deleteMemoryRecord } from "./deleteMemoryRecord.mutation.js";
import { updateMemoryRecord } from "./updateMemoryRecord.mutation.js";
import { captureMobileMemory } from "./captureMobileMemory.mutation.js";
import { mobileMemoryCaptures } from "./mobileMemoryCaptures.query.js";
import { mobileMemorySearch } from "./mobileMemorySearch.query.js";
import { deleteMobileMemoryCapture } from "./deleteMobileMemoryCapture.mutation.js";

export const memoryQueries = {
	memoryRecords,
	memorySearch,
	memoryGraph,
	memorySystemConfig,
	mobileMemoryCaptures,
	mobileMemorySearch,
};

export const memoryMutations = {
	deleteMemoryRecord,
	updateMemoryRecord,
	captureMobileMemory,
	deleteMobileMemoryCapture,
};

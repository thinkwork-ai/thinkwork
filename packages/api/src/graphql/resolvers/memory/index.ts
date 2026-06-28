import { memoryRecords } from "./memoryRecords.query.js";
import { memorySearch } from "./memorySearch.query.js";
import { memoryGraph } from "./memoryGraph.query.js";
import { memorySystemConfig } from "./memorySystemConfig.query.js";
import { deleteMemoryRecord } from "./deleteMemoryRecord.mutation.js";
import { updateMemoryRecord } from "./updateMemoryRecord.mutation.js";
import { captureMobileMemory } from "./captureMobileMemory.mutation.js";
import { captureSpaceMemory } from "./captureSpaceMemory.mutation.js";
import { ingestSpaceMemoryDocument } from "./ingestSpaceMemoryDocument.mutation.js";
import { mobileMemoryCaptures } from "./mobileMemoryCaptures.query.js";
import { mobileMemorySearch } from "./mobileMemorySearch.query.js";
import { mobileWikiSearch } from "./mobileWikiSearch.query.js";
import { recentWikiPages } from "./recentWikiPages.query.js";
import { deleteMobileMemoryCapture } from "./deleteMobileMemoryCapture.mutation.js";
import {
  threadIdleLearningRunQuery,
  threadIdleLearningRunsQuery,
} from "./threadIdleLearningRuns.query.js";
import { rollbackThreadIdleLearningRun } from "./rollbackThreadIdleLearningRun.mutation.js";
import { spaceMemorySearch } from "./spaceMemorySearch.query.js";
import { memoryRetainAttempts } from "./memoryRetainAttempts.query.js";

export const memoryQueries = {
  memoryRecords,
  memorySearch,
  spaceMemorySearch,
  memoryGraph,
  memorySystemConfig,
  memoryRetainAttempts,
  mobileMemoryCaptures,
  mobileMemorySearch,
  mobileWikiSearch,
  recentWikiPages,
  threadIdleLearningRuns: threadIdleLearningRunsQuery,
  threadIdleLearningRun: threadIdleLearningRunQuery,
};

export const memoryMutations = {
  deleteMemoryRecord,
  updateMemoryRecord,
  captureMobileMemory,
  captureSpaceMemory,
  ingestSpaceMemoryDocument,
  deleteMobileMemoryCapture,
  rollbackThreadIdleLearningRun,
};

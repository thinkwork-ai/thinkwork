import { memoryRecords } from "./memoryRecords.query.js";
import { memoryRecordsByIds } from "./memoryRecordsByIds.query.js";
import { memoryEpisodicRecords } from "./memoryEpisodicRecords.query.js";
import { memorySearch } from "./memorySearch.query.js";
import { memorySystemConfig } from "./memorySystemConfig.query.js";
import { deleteMemoryRecord } from "./deleteMemoryRecord.mutation.js";
import { updateMemoryRecord } from "./updateMemoryRecord.mutation.js";
import { captureMobileMemory } from "./captureMobileMemory.mutation.js";
import { mobileMemoryCaptures } from "./mobileMemoryCaptures.query.js";
import { mobileMemorySearch } from "./mobileMemorySearch.query.js";
import { deleteMobileMemoryCapture } from "./deleteMobileMemoryCapture.mutation.js";
import {
  threadIdleLearningRunQuery,
  threadIdleLearningRunsQuery,
} from "./threadIdleLearningRuns.query.js";
import { rollbackThreadIdleLearningRun } from "./rollbackThreadIdleLearningRun.mutation.js";
import { memoryRetainAttempts } from "./memoryRetainAttempts.query.js";

export const memoryQueries = {
  memoryRecords,
  memoryRecordsByIds,
  memoryEpisodicRecords,
  memorySearch,
  memorySystemConfig,
  memoryRetainAttempts,
  mobileMemoryCaptures,
  mobileMemorySearch,
  threadIdleLearningRuns: threadIdleLearningRunsQuery,
  threadIdleLearningRun: threadIdleLearningRunQuery,
};

export const memoryMutations = {
  deleteMemoryRecord,
  updateMemoryRecord,
  captureMobileMemory,
  deleteMobileMemoryCapture,
  rollbackThreadIdleLearningRun,
};

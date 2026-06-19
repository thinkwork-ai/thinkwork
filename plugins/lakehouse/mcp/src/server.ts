import {
  projectSummary,
  runEvidence,
  selectedStreams,
} from "./tools/read-only";
import { runJob } from "./tools/write-gated";

export const lakehouseMcpTools = {
  projectSummary,
  selectedStreams,
  runEvidence,
  runJob,
};

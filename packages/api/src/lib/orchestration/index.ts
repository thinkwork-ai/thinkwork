/**
 * PRD-22: Orchestration barrel export.
 */
export { checkAndFireUnblockWakeups, releaseThreadWithSignal } from "./thread-release.js";
export { resolveWorkflowConfig } from "./workflow-config.js";
export type { ResolvedWorkflowConfig, OrchestrationConfig, TurnLoopConfig, WorkspaceConfig, SessionCompactionConfig } from "./workflow-config.js";
export { renderPromptTemplate } from "./prompt-template.js";
export type { PromptTemplateContext } from "./prompt-template.js";
export { parseProcessTemplate } from "./process-parser.js";
export type { ProcessTemplate, ProcessStep, ProcessConfig } from "./process-parser.js";
export { materializeProcess } from "./process-materializer.js";
export type { MaterializeInput, MaterializeResult } from "./process-materializer.js";

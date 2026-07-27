export { ThinkworkProvider } from "./provider";
export { useThinkworkAuth } from "./auth/provider";
export { useThinkworkClient } from "./graphql/provider";
export {
  createThinkworkClient,
  type ThinkworkGraphqlClient,
} from "./graphql/client";
export { setAuthToken, getAuthToken, onAuthTokenChange } from "./graphql/token";
export { defaultLogger } from "./logger";

export { useAgents } from "./hooks/use-agents";
export { useThreads, type UseThreadsArgs } from "./hooks/use-threads";
export { useUnreadThreadCount } from "./hooks/use-unread-count";
export {
  useThread,
  useCreateThread,
  useUpdateThread,
} from "./hooks/use-thread";
export {
  useMessages,
  useSendMessage,
  type SendMessageGoalMode,
  type SendMessageOptions,
} from "./hooks/use-messages";
export { buildSendMessageMutationVariables } from "./send-message-options";
export {
  ComposerCapabilities,
  type ComposerCapability,
} from "./composer-capabilities";
export {
  useNewMessageSubscription,
  useThreadTurnSubscription,
  useThreadTurnUpdatedSubscription,
  useThreadUpdatedSubscription,
  useWorkspaceAccessRevokedSubscription,
  type NewMessageEvent,
  type ThreadTurnUpdateEvent,
  type ThreadUpdateEvent,
  type WorkspaceAccessRevokedEvent,
} from "./hooks/use-subscriptions";
export { useCaptureMobileMemory } from "./hooks/use-capture-mobile-memory";
export {
  SKILL_CREATOR_COMMAND,
  SKILL_CREATOR_FALLBACK_PROMPT,
  normalizeSkillCreatorCommandContent,
  type SkillCreatorCommandMetadata,
} from "./skill-creator-command";
export {
  useMobileMemoryCaptures,
  useDeleteMobileMemoryCapture,
} from "./hooks/use-mobile-memory-captures";
export {
  queryContext,
  type ContextEngineResponse,
  type ContextEngineHit,
  type ContextProviderStatus,
  type ContextProviderFamily,
  type ContextSourceFamily,
} from "./context-engine";
export {
  useContextQuery,
  type UseContextQueryArgs,
} from "./hooks/use-context-query";

export type {
  ThinkworkConfig,
  ThinkworkEnvironment,
  ThinkworkLogger,
  ThinkworkUser,
  ThinkworkAuthStatus,
  ThinkworkAuthContextValue,
  Agent,
  Thread,
  ThreadEntityRef,
  ThreadMetadata,
  Message,
  ThreadTurn,
  CreateThreadInput,
  UpdateThreadInput,
  MobileCaptureFactType,
  MobileMemoryCapture,
  CaptureMobileMemoryInput,
} from "./types";

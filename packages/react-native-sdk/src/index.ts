export { ThinkworkProvider } from "./provider";
export { useThinkworkAuth } from "./auth/provider";
export { useThinkworkClient } from "./graphql/provider";
export { createThinkworkClient, type ThinkworkGraphqlClient } from "./graphql/client";
export { setAuthToken, getAuthToken, onAuthTokenChange } from "./graphql/token";
export { defaultLogger } from "./logger";

export { useAgents } from "./hooks/use-agents";
export { useThreads } from "./hooks/use-threads";
export { useUnreadThreadCount } from "./hooks/use-unread-count";
export { useThread, useCreateThread, useUpdateThread } from "./hooks/use-thread";
export { useMessages, useSendMessage } from "./hooks/use-messages";
export {
  useNewMessageSubscription,
  useThreadTurnSubscription,
  type NewMessageEvent,
  type ThreadTurnUpdateEvent,
} from "./hooks/use-subscriptions";

export type {
  ThinkworkConfig,
  ThinkworkEnvironment,
  ThinkworkLogger,
  ThinkworkUser,
  ThinkworkAuthStatus,
  ThinkworkAuthContextValue,
  Agent,
  Thread,
  Message,
  ThreadTurn,
  CreateThreadInput,
  UpdateThreadInput,
} from "./types";

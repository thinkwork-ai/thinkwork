export type ThinkworkEnvironment = "prod" | "staging" | "dev";

export interface ThinkworkConfig {
  apiBaseUrl: string;
  graphqlUrl: string;
  graphqlWsUrl?: string;
  graphqlApiKey?: string;
  cognito: {
    userPoolId: string;
    userPoolClientId: string;
    region: string;
    hostedUiDomain?: string;
  };
  oauthRedirectUri?: string;
  tenantSlug?: string;
  environment?: ThinkworkEnvironment;
  logger?: ThinkworkLogger;
}

export interface ThinkworkLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface ThinkworkUser {
  sub: string;
  email: string;
  name?: string;
  tenantId?: string;
}

export type ThinkworkAuthStatus =
  | "unknown"
  | "signed-out"
  | "signed-in"
  | "error";

export interface ThinkworkAuthContextValue {
  status: ThinkworkAuthStatus;
  user: ThinkworkUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

export interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";

export interface Message {
  id: string;
  threadId: string;
  tenantId: string;
  role: MessageRole;
  content: string | null;
  senderType: string | null;
  senderId: string | null;
  createdAt: string;
}

export interface ThreadTurn {
  runId: string;
  triggerId: string | null;
  tenantId: string;
  threadId: string | null;
  agentId: string | null;
  status: string;
  triggerName: string | null;
  updatedAt: string;
}

export interface CreateThreadInput {
  tenantId: string;
  title: string;
  agentId?: string;
  description?: string;
}

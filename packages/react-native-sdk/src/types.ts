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
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  authorId: string | null;
  role: string;
  kind: string;
  content: string;
  createdAt: string;
}

export interface ThreadTurn {
  turnId: string;
  threadId: string;
  status: string;
  updatedAt: string;
}

export interface CreateThreadInput {
  title?: string;
  agentId?: string;
  tenantId: string;
}

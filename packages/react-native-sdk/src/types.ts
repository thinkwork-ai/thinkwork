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

export interface Agent {
  id: string;
  name: string;
  slug?: string | null;
  role?: string | null;
  type?: string | null;
  status?: string | null;
  avatarUrl?: string | null;
}

export interface Thread {
  id: string;
  tenantId?: string;
  agentId?: string | null;
  number?: number;
  identifier?: string | null;
  title: string;
  status?: string;
  priority?: string;
  type?: string;
  channel?: string;
  assigneeId?: string | null;
  lastActivityAt?: string | null;
  lastReadAt?: string | null;
  archivedAt?: string | null;
  lastResponsePreview?: string | null;
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
  channel?: string;
  type?: string;
  priority?: string;
  createdByType?: string;
  createdById?: string;
  // Optional opening user message. Lets hosts avoid the "create thread then
  // send message" round-trip by atomically minting a thread with its first
  // user message in a single mutation.
  firstMessage?: string;
}

export interface UpdateThreadInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  type?: string;
  channel?: string;
  assigneeType?: string;
  assigneeId?: string;
  archivedAt?: string | null;
  lastReadAt?: string | null;
}

export type MobileCaptureFactType = "FACT" | "PREFERENCE" | "EXPERIENCE" | "OBSERVATION";

export interface MobileMemoryCapture {
  id: string;
  tenantId: string;
  agentId: string;
  content: string;
  factType: MobileCaptureFactType;
  capturedAt: string;
  syncedAt?: string | null;
  metadata?: string | null;
}

export interface CaptureMobileMemoryInput {
  agentId: string;
  content: string;
  factType?: MobileCaptureFactType;
  metadata?: Record<string, unknown>;
  clientCaptureId?: string;
}

export type WikiPageType = "ENTITY" | "TOPIC" | "DECISION";

export interface WikiSearchHit {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
  summary?: string | null;
  lastCompiledAt?: string | null;
  score: number;
  matchedAlias?: string | null;
}

export type ContextEngineMode = "results" | "answer";
export type ContextEngineScope = "personal" | "team" | "auto";
export type ContextEngineDepth = "quick" | "deep";
export type ContextProviderFamily =
  | "memory"
  | "wiki"
  | "workspace"
  | "knowledge-base"
  | "mcp";

export interface ContextEngineCaller {
  tenantId: string;
  userId?: string | null;
  agentId?: string | null;
  templateId?: string | null;
  traceId?: string | null;
}

export interface ContextProviderSelection {
  ids?: string[];
  families?: ContextProviderFamily[];
}

export interface ContextProviderOptions {
  memory?: {
    queryMode?: "recall" | "reflect";
    includeLegacyBanks?: boolean;
  };
}

export interface ContextEngineRequest {
  query: string;
  mode?: ContextEngineMode;
  scope?: ContextEngineScope;
  depth?: ContextEngineDepth;
  limit?: number;
  providers?: ContextProviderSelection;
  providerOptions?: ContextProviderOptions;
  caller: ContextEngineCaller;
}

export interface ContextEngineProviderRequest
  extends Omit<ContextEngineRequest, "providers"> {
  limit: number;
  mode: ContextEngineMode;
  scope: ContextEngineScope;
  depth: ContextEngineDepth;
}

export interface ContextHitProvenance {
  label?: string;
  uri?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface ContextHit {
  id: string;
  providerId: string;
  family: ContextProviderFamily;
  title: string;
  snippet: string;
  score?: number | null;
  rank?: number | null;
  scope: ContextEngineScope;
  provenance: ContextHitProvenance;
  metadata?: Record<string, unknown>;
}

export type ContextProviderStatusState = "ok" | "skipped" | "error" | "timeout";

export interface ContextProviderStatus {
  providerId: string;
  family: ContextProviderFamily;
  displayName: string;
  state: ContextProviderStatusState;
  scope: ContextEngineScope;
  durationMs?: number;
  hitCount?: number;
  error?: string;
  reason?: string;
  defaultEnabled?: boolean;
}

export interface ContextProviderResult {
  hits: ContextHit[];
  status?: Partial<ContextProviderStatus>;
}

export interface ContextProviderDescriptor {
  id: string;
  family: ContextProviderFamily;
  displayName: string;
  enabled?: boolean;
  defaultEnabled: boolean;
  config?: Record<string, unknown>;
  supportedScopes?: ContextEngineScope[];
  timeoutMs?: number;
  query(request: ContextEngineProviderRequest): Promise<ContextProviderResult>;
  status?(
    request: ContextEngineProviderRequest,
  ): Promise<Partial<ContextProviderStatus> | null>;
}

export interface ContextEngineAnswer {
  text: string;
  hitIds: string[];
}

export interface ContextEngineResponse {
  query: string;
  mode: ContextEngineMode;
  scope: ContextEngineScope;
  depth: ContextEngineDepth;
  hits: ContextHit[];
  providers: ContextProviderStatus[];
  answer?: ContextEngineAnswer;
  traceId?: string | null;
}

export class ContextEngineValidationError extends Error {
  override readonly name = "ContextEngineValidationError";
}

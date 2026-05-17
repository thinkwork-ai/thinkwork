export type RuntimeTask = {
  id: string;
  taskType: string;
  input?: unknown;
  idempotencyKey?: string | null;
  createdByUserId?: string | null;
};

export type RuntimeApiConfig = {
  apiUrl: string;
  apiSecret: string;
  tenantId: string;
  computerId: string;
};

export type GoogleCalendarUpcomingInput = {
  timeMin: string;
  timeMax: string;
  maxResults: number;
};

export type ThreadTurnContext = {
  taskId: string;
  source: string;
  requester?: {
    userId?: string | null;
    actorType?: string | null;
    actorId?: string | null;
    contextClass?: string | null;
  };
  surfaceContext?: Record<string, unknown> | null;
  requesterContext?: {
    contextClass: string;
    computerId: string;
    requester: {
      userId: string | null;
    };
    sourceSurface: string;
    credentialSubject?: {
      type: "user" | "service";
      userId?: string | null;
      connectionId?: string | null;
      provider?: string | null;
    };
    event?: {
      provider?: string | null;
      eventType?: string | null;
      eventId?: string | null;
      metadata?: Record<string, unknown> | null;
    };
    personalMemory: {
      hits: Array<{
        id: string;
        title: string;
        text: string;
        score: number;
        provenance?: Record<string, unknown>;
      }>;
      status: {
        providerId: string;
        displayName: string;
        state: string;
        hitCount: number;
        reason?: string;
        metadata?: Record<string, unknown>;
      };
    };
  } | null;
  computer: {
    id: string;
    name: string;
    slug: string;
    workspaceRoot?: string | null;
  };
  thread: {
    id: string;
    title: string;
  };
  message: {
    id: string;
    content: string;
  };
  attachments?: Array<{
    attachmentId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    readable: boolean;
    truncated?: boolean;
    contentText?: string;
    reason?: string;
  }>;
  messagesHistory: Array<{
    id: string;
    role: "user" | "assistant" | string;
    content: string;
  }>;
  model?: string | null;
  systemPrompt?: string | null;
};

export type RunbookExecutionContext = {
  taskId: string;
  run: {
    id: string;
    status: string;
    runbookSlug: string;
    runbookVersion: string;
  };
  tasks: Array<{
    id: string;
    phaseId: string;
    phaseTitle: string;
    taskKey: string;
    title: string;
    summary?: string | null;
    status:
      | "pending"
      | "running"
      | "completed"
      | "failed"
      | "skipped"
      | "cancelled";
    dependsOn: string[];
    capabilityRoles: string[];
    sortOrder: number;
    output?: unknown;
    error?: unknown;
  }>;
  definitionSnapshot?: unknown;
  inputs?: unknown;
  previousOutputs: Record<string, unknown>;
};

export type RunbookAgentStepOutput = {
  ok: true;
  responseText: string;
  model?: string | null;
  usage?: unknown;
  toolInvocations?: Array<Record<string, unknown>>;
  durationMs?: number;
};

export type RunbookAgentStepDispatch = {
  ok: true;
  dispatched?: true;
  invocation?: RunbookAgentCoreInvocation;
  runbookTaskId: string;
  status: "running";
};

export type RunbookAgentCoreInvocation = {
  provider: "bedrock-agentcore";
  runtimeArn: string;
  runtimeSessionId: string;
  payload: Record<string, unknown>;
};

export class ComputerRuntimeApi {
  constructor(private readonly config: RuntimeApiConfig) {}

  async fetchConfig() {
    const params = new URLSearchParams({
      tenantId: this.config.tenantId,
      computerId: this.config.computerId,
    });
    return this.request(`/api/computers/runtime/config?${params}`, {
      method: "GET",
    });
  }

  async heartbeat(input: {
    runtimeStatus: string;
    runtimeVersion: string;
    workspaceRoot: string;
  }) {
    return this.request("/api/computers/runtime/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        tenantId: this.config.tenantId,
        computerId: this.config.computerId,
        ...input,
      }),
    });
  }

  async claimTask(): Promise<RuntimeTask | null> {
    const result = await this.request<{ task: RuntimeTask | null }>(
      "/api/computers/runtime/tasks/claim",
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
        }),
      },
    );
    return result.task;
  }

  async appendTaskEvent(
    taskId: string,
    input: {
      eventType: string;
      level?: string;
      payload?: unknown;
    },
  ) {
    return this.request(`/api/computers/runtime/tasks/${taskId}/events`, {
      method: "POST",
      body: JSON.stringify({
        tenantId: this.config.tenantId,
        computerId: this.config.computerId,
        ...input,
      }),
    });
  }

  async checkGoogleWorkspaceConnection(input?: {
    requesterUserId?: string | null;
  }): Promise<{
    providerName: string;
    connected: boolean;
    tokenResolved: boolean;
    connectionId?: string;
    grantedScopes?: string[];
    missingScopes?: string[];
    calendarScopeGranted?: boolean;
    reason?: string | null;
    checkedAt?: string;
  }> {
    return this.request("/api/computers/runtime/google-workspace/check", {
      method: "POST",
      body: JSON.stringify({
        tenantId: this.config.tenantId,
        computerId: this.config.computerId,
        requesterUserId: input?.requesterUserId ?? null,
      }),
    });
  }

  async resolveGoogleWorkspaceCliToken(input?: {
    requesterUserId?: string | null;
  }): Promise<{
    providerName: string;
    connected: boolean;
    tokenResolved: boolean;
    accessToken?: string;
    connectionId?: string;
    grantedScopes?: string[];
    missingScopes?: string[];
    reason?: string | null;
    checkedAt?: string;
  }> {
    return this.request("/api/computers/runtime/google-workspace/cli-token", {
      method: "POST",
      body: JSON.stringify({
        tenantId: this.config.tenantId,
        computerId: this.config.computerId,
        requesterUserId: input?.requesterUserId ?? null,
      }),
    });
  }

  async completeTask(taskId: string, output: unknown) {
    return this.request(`/api/computers/runtime/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({
        tenantId: this.config.tenantId,
        computerId: this.config.computerId,
        output,
      }),
    });
  }

  async cancelTask(taskId: string, output: unknown) {
    return this.request(`/api/computers/runtime/tasks/${taskId}/cancel`, {
      method: "POST",
      body: JSON.stringify({
        tenantId: this.config.tenantId,
        computerId: this.config.computerId,
        output,
      }),
    });
  }

  async executeThreadTurn(taskId: string): Promise<{
    dispatched: boolean;
    mode: "managed_agent";
    agentId: string;
    threadId: string;
    messageId: string;
    source?: string;
    status: string;
  }> {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/execute-thread-turn`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
        }),
      },
    );
  }

  async loadThreadTurnContext(taskId: string): Promise<ThreadTurnContext> {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/thread-turn-context`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
        }),
      },
    );
  }

  async recordThreadTurnResponse(
    taskId: string,
    input: {
      content: string;
      model?: string;
      usage?: unknown;
    },
  ): Promise<{
    responded: boolean;
    mode: "computer_native";
    responseMessageId: string;
    threadId: string;
    messageId: string;
    status: string;
    model?: string | null;
  }> {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/thread-turn-response`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
          ...input,
        }),
      },
    );
  }

  async loadRunbookExecutionContext(
    taskId: string,
  ): Promise<RunbookExecutionContext> {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/runbook/context`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
        }),
      },
    );
  }

  async startRunbookTask(taskId: string, runbookTaskId: string) {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/runbook/tasks/${runbookTaskId}/start`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
        }),
      },
    );
  }

  async completeRunbookTask(
    taskId: string,
    runbookTaskId: string,
    output: unknown,
  ) {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/runbook/tasks/${runbookTaskId}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
          output,
        }),
      },
    );
  }

  async executeRunbookTask(
    taskId: string,
    runbookTaskId: string,
  ): Promise<RunbookAgentStepOutput | RunbookAgentStepDispatch> {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/runbook/tasks/${runbookTaskId}/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
        }),
      },
    );
  }

  async recordRunbookResponse(
    taskId: string,
    input: {
      content: string;
      model?: string | null;
      usage?: unknown;
    },
  ) {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/runbook/response`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
          ...input,
        }),
      },
    );
  }

  async failRunbookTask(taskId: string, runbookTaskId: string, error: unknown) {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/runbook/tasks/${runbookTaskId}/fail`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
          error,
        }),
      },
    );
  }

  async completeRunbookRun(taskId: string, output: unknown) {
    return this.request(
      `/api/computers/runtime/tasks/${taskId}/runbook/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          computerId: this.config.computerId,
          output,
        }),
      },
    );
  }

  async failTask(taskId: string, error: unknown) {
    return this.request(`/api/computers/runtime/tasks/${taskId}/fail`, {
      method: "POST",
      body: JSON.stringify({
        tenantId: this.config.tenantId,
        computerId: this.config.computerId,
        error,
      }),
    });
  }

  private async request<T = any>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(
      `${this.config.apiUrl.replace(/\/+$/, "")}${path}`,
      {
        ...init,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiSecret}`,
          ...init.headers,
        },
      },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
      throw new Error(message);
    }
    return body as T;
  }
}

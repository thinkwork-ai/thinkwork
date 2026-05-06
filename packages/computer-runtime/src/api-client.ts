export type RuntimeTask = {
  id: string;
  taskType: string;
  input?: unknown;
  idempotencyKey?: string | null;
};

export type RuntimeApiConfig = {
  apiUrl: string;
  apiSecret: string;
  tenantId: string;
  computerId: string;
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

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export type KestraCredentials = {
  username: string;
  password: string;
};

export type KestraClientOptions = {
  endpoint: string;
  credentials: KestraCredentials;
  fetchImpl?: typeof fetch;
};

export type KestraRequestOptions = {
  method?: string;
  body?: BodyInit | string;
  headers?: Record<string, string>;
};

export type KestraApiErrorData = {
  status: number;
  method: string;
  path: string;
  message: string;
  bodyPreview?: string;
};

export class KestraApiError extends Error {
  readonly data: KestraApiErrorData;

  constructor(data: KestraApiErrorData) {
    super(data.message);
    this.name = "KestraApiError";
    this.data = data;
  }
}

export class KestraClient {
  private readonly endpoint: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KestraClientOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.authHeader = `Basic ${Buffer.from(
      `${options.credentials.username}:${options.credentials.password}`,
    ).toString("base64")}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async namespacesList(): Promise<unknown> {
    return this.requestJson("/api/v1/main/namespaces");
  }

  async flowGet(namespace: string, flowId: string): Promise<unknown> {
    return this.requestJson(
      `/api/v1/main/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(flowId)}`,
    );
  }

  async flowUpsert(source: string): Promise<unknown> {
    return this.requestJson("/api/v1/main/flows", {
      method: "POST",
      body: source,
      headers: { "Content-Type": "application/x-yaml" },
    });
  }

  async executionStart(
    namespace: string,
    flowId: string,
    inputs?: Record<string, unknown>,
  ): Promise<unknown> {
    const body = inputs ? inputsAsFormData(inputs) : undefined;
    return this.requestJson(
      `/api/v1/main/executions/${encodeURIComponent(namespace)}/${encodeURIComponent(flowId)}`,
      {
        method: "POST",
        body,
      },
    );
  }

  async executionGet(executionId: string): Promise<unknown> {
    return this.requestJson(
      `/api/v1/main/executions/${encodeURIComponent(executionId)}`,
    );
  }

  async executionLogs(executionId: string): Promise<unknown> {
    return this.requestJson(
      `/api/v1/main/logs/${encodeURIComponent(executionId)}`,
    );
  }

  private async requestJson(
    path: string,
    options: KestraRequestOptions = {},
  ): Promise<unknown> {
    const method = options.method ?? "GET";
    const response = await this.fetchImpl(`${this.endpoint}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
      body: options.body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new KestraApiError({
        status: response.status,
        method,
        path,
        message: `Kestra API ${method} ${path} returned ${response.status}`,
        bodyPreview: text.slice(0, 300),
      });
    }
    if (!text) return {};
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      return JSON.parse(text);
    }
    return { text };
  }
}

export async function createKestraClientFromEnv(
  options: { fetchImpl?: typeof fetch } = {},
): Promise<KestraClient> {
  const status = readKestraRuntimeStatus();
  if (!status.provisioned || !status.runtimeEnabled) {
    throw new Error("Kestra runtime is not running for this stage.");
  }
  if (!status.url) {
    throw new Error("Kestra URL is not configured.");
  }
  if (!status.basicAuthSecretArn) {
    throw new Error("Kestra basic-auth credential secret is not configured.");
  }
  const credentials = await readKestraCredentials(status.basicAuthSecretArn);
  return new KestraClient({
    endpoint: status.url,
    credentials,
    fetchImpl: options.fetchImpl,
  });
}

export function readKestraRuntimeStatus(): {
  provisioned: boolean;
  runtimeEnabled: boolean;
  url: string | null;
  basicAuthSecretArn: string | null;
} {
  const raw = process.env.KESTRA || process.env.KESTRA_STATUS;
  if (raw) {
    const parts = raw.split("|");
    const provisioned = truthyFlag(parts[0]);
    return {
      provisioned,
      runtimeEnabled: truthyFlag(parts[1]),
      url:
        nonEmpty(parts[2]) ??
        process.env.KESTRA_URL ??
        deriveKestraUrlFromWwwUrl(),
      basicAuthSecretArn:
        nonEmpty(parts[8]) ??
        process.env.KESTRA_BASIC_AUTH_SECRET_ARN ??
        process.env.KESTRA_SERVICE_CREDENTIAL_SECRET_ARN ??
        deriveKestraBasicAuthSecretRef(provisioned),
    };
  }
  const provisioned = truthyFlag(process.env.KESTRA_PROVISIONED);
  return {
    provisioned,
    runtimeEnabled: truthyFlag(process.env.KESTRA_RUNTIME_ENABLED),
    url: process.env.KESTRA_URL || deriveKestraUrlFromWwwUrl(),
    basicAuthSecretArn:
      process.env.KESTRA_BASIC_AUTH_SECRET_ARN ||
      process.env.KESTRA_SERVICE_CREDENTIAL_SECRET_ARN ||
      deriveKestraBasicAuthSecretRef(provisioned),
  };
}

async function readKestraCredentials(
  secretArn: string,
): Promise<KestraCredentials> {
  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!response.SecretString) {
    throw new Error("Kestra credential secret is empty.");
  }
  const parsed = JSON.parse(response.SecretString) as {
    username?: unknown;
    password?: unknown;
  };
  if (
    typeof parsed.username !== "string" ||
    typeof parsed.password !== "string"
  ) {
    throw new Error(
      "Kestra credential secret must contain username and password fields.",
    );
  }
  return { username: parsed.username, password: parsed.password };
}

function inputsAsFormData(inputs: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(inputs)) {
    form.append(
      key,
      typeof value === "string" ? value : JSON.stringify(value ?? null),
    );
  }
  return form;
}

function truthyFlag(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "enabled", "on"].includes(normalized);
}

function deriveKestraUrlFromWwwUrl(): string | null {
  const raw = process.env.WWW_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!url.hostname) return null;
    return `${url.protocol}//orchestrate.${url.hostname}`;
  } catch {
    const host = raw
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    return host ? `https://orchestrate.${host}` : null;
  }
}

function deriveKestraBasicAuthSecretRef(provisioned: boolean): string | null {
  if (!provisioned) return null;
  const stage = process.env.STAGE || "dev";
  return `thinkwork/${stage}/kestra/basic-auth`;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

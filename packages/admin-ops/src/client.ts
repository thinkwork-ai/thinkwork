export interface AdminOpsClientConfig {
	apiUrl: string;
	authSecret: string;
	principalId?: string;
	principalEmail?: string;
	tenantId?: string;
	agentId?: string;
	fetchImpl?: typeof fetch;
}

export interface AdminOpsClient {
	fetch<T = unknown>(path: string, init?: RequestInit): Promise<T>;
	readonly apiUrl: string;
	readonly tenantId: string | undefined;
	withTenant(tenantId: string): AdminOpsClient;
}

export class AdminOpsError extends Error {
	readonly status: number;
	readonly body: unknown;
	constructor(status: number, message: string, body: unknown) {
		super(message);
		this.name = "AdminOpsError";
		this.status = status;
		this.body = body;
	}
}

export function createClient(config: AdminOpsClientConfig): AdminOpsClient {
	const fetchImpl = config.fetchImpl ?? fetch;
	const base = config.apiUrl.replace(/\/+$/, "");

	const doFetch = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.authSecret}`,
		};
		if (config.principalId) headers["x-principal-id"] = config.principalId;
		if (config.principalEmail) headers["x-principal-email"] = config.principalEmail;
		if (config.tenantId) headers["x-tenant-id"] = config.tenantId;
		if (config.agentId) headers["x-agent-id"] = config.agentId;

		const res = await fetchImpl(`${base}${path}`, {
			...init,
			headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			const message = (body as { error?: string }).error ?? `HTTP ${res.status}`;
			throw new AdminOpsError(res.status, message, body);
		}

		return res.json() as Promise<T>;
	};

	return {
		apiUrl: base,
		tenantId: config.tenantId,
		fetch: doFetch,
		withTenant(tenantId: string) {
			return createClient({ ...config, tenantId });
		},
	};
}

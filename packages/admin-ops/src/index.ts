export {
	createClient,
	AdminOpsError,
	type AdminOpsClient,
	type AdminOpsClientConfig,
} from "./client.js";

export * as tenants from "./tenants.js";
export type { Tenant, TenantSummary, UpdateTenantInput } from "./tenants.js";

export * as adminKeys from "./admin-keys.js";
export type {
	AdminKeyCreateInput,
	AdminKeyCreateResponse,
	AdminKeySummary,
} from "./admin-keys.js";

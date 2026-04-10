/**
 * AgentCore Admin Lambda — SSM permission CRUD + CloudWatch audit queries.
 *
 * Called by app-manager for AgentCore assistant management operations that require
 * AWS API access (SSM Parameter Store, CloudWatch Logs).
 */

import {
	SSMClient,
	GetParameterCommand,
	PutParameterCommand,
} from "@aws-sdk/client-ssm";
import {
	CloudWatchLogsClient,
	FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const ssm = new SSMClient({});
const cwLogs = new CloudWatchLogsClient({});

function respond(status: number, body: Record<string, unknown>) {
	return {
		statusCode: status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
		},
		body: JSON.stringify(body),
	};
}

export async function handler(event: any) {
	const method =
		event.requestContext?.http?.method || event.httpMethod || "GET";
	const path = event.requestContext?.http?.path || event.path || "/";

	// CORS preflight
	if (method === "OPTIONS") {
		return respond(200, {});
	}

	// Health check
	if (method === "GET" && path === "/health") {
		return respond(200, { status: "ok", service: "agentcore-admin" });
	}

	// Auth: require Bearer token matching AGENTCORE_ADMIN_TOKEN env
	const authHeader =
		event.headers?.authorization || event.headers?.Authorization || "";
	const token = authHeader.replace("Bearer ", "");
	const expectedToken = process.env.AGENTCORE_ADMIN_TOKEN;
	if (!expectedToken || token !== expectedToken) {
		return respond(401, { error: "Unauthorized" });
	}

	let body: any;
	try {
		body = JSON.parse(event.body || "{}");
	} catch {
		return respond(400, { error: "Invalid JSON body" });
	}

	// Route
	try {
		if (method === "GET" && path.startsWith("/permissions/")) {
			return await getPermissions(path);
		}
		if (method === "PUT" && path.startsWith("/permissions/")) {
			return await putPermissions(path, body);
		}
		if (method === "POST" && path === "/audit-query") {
			return await queryAuditLogs(body);
		}
		return respond(404, { error: "Not found" });
	} catch (err: any) {
		console.error("AgentCore admin error:", err);
		return respond(500, { error: err.message || "Internal error" });
	}
}

// ---------------------------------------------------------------------------
// SSM Permission Profile CRUD
// ---------------------------------------------------------------------------

async function getPermissions(path: string) {
	// Path: /permissions/{stackName}/{tenantId}
	const parts = path.split("/").filter(Boolean);
	// parts: ["permissions", stackName, tenantId]
	if (parts.length < 3) {
		return respond(400, { error: "Path must be /permissions/{stackName}/{tenantId}" });
	}
	const stackName = parts[1];
	const tenantId = parts[2];
	const ssmPath = `/thinkwork/${stackName}/agentcore/tenants/${tenantId}/permissions`;

	try {
		const result = await ssm.send(
			new GetParameterCommand({ Name: ssmPath }),
		);
		const profile = JSON.parse(result.Parameter?.Value || "{}");
		return respond(200, { tenantId, profile });
	} catch (err: any) {
		if (err.name === "ParameterNotFound") {
			// Return default basic profile
			return respond(200, {
				tenantId,
				profile: {
					profile: "basic",
					tools: ["web_search"],
					data_permissions: {},
				},
			});
		}
		throw err;
	}
}

async function putPermissions(path: string, body: any) {
	const parts = path.split("/").filter(Boolean);
	if (parts.length < 3) {
		return respond(400, { error: "Path must be /permissions/{stackName}/{tenantId}" });
	}
	const stackName = parts[1];
	const tenantId = parts[2];
	const ssmPath = `/thinkwork/${stackName}/agentcore/tenants/${tenantId}/permissions`;

	const profile = body.profile;
	if (!profile) {
		return respond(400, { error: "profile field required" });
	}

	await ssm.send(
		new PutParameterCommand({
			Name: ssmPath,
			Value: JSON.stringify(profile),
			Type: "String",
			Overwrite: true,
		}),
	);

	return respond(200, { tenantId, profile, updated: true });
}

// ---------------------------------------------------------------------------
// CloudWatch Audit Log Query
// ---------------------------------------------------------------------------

async function queryAuditLogs(body: any) {
	const { stackName, tenantId, startTime, endTime, limit } = body;
	if (!stackName) {
		return respond(400, { error: "stackName required" });
	}

	const logGroupName = `/thinkwork/${stackName}/agentcore/agents`;
	const filterParams: any = {
		logGroupName,
		limit: limit || 50,
		interleaved: true,
	};

	if (startTime) filterParams.startTime = startTime;
	if (endTime) filterParams.endTime = endTime;
	if (tenantId) {
		filterParams.filterPattern = `"tenant_id" "${tenantId}"`;
	}

	const result = await cwLogs.send(
		new FilterLogEventsCommand(filterParams),
	);

	const events = (result.events || []).map((e) => {
		try {
			// Try to parse structured log entries
			const match = e.message?.match(/STRUCTURED_LOG\s+(.+)/);
			if (match) {
				return { ...JSON.parse(match[1]), logTimestamp: e.timestamp };
			}
			return { message: e.message, logTimestamp: e.timestamp };
		} catch {
			return { message: e.message, logTimestamp: e.timestamp };
		}
	});

	return respond(200, { events, count: events.length });
}

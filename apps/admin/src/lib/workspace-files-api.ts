/**
 * Admin client for the /api/workspaces/files Lambda (Unit 5).
 *
 * Supersedes the per-route `workspaceApi` fetch wrappers that used the
 * VITE_API_AUTH_SECRET bearer token. The new handler validates Cognito
 * JWTs and derives the caller's tenant server-side — callers must send
 * agentId / templateId / defaults:true, never tenantSlug.
 */

import { getIdToken } from "@/lib/auth";

const API_URL = import.meta.env.VITE_API_URL || "";

export type Target =
	| { agentId: string }
	| { templateId: string }
	| { defaults: true };

export type ComposeSource =
	| "agent-override"
	| "agent-override-pinned"
	| "template"
	| "template-pinned"
	| "defaults";

export interface WorkspaceFileMeta {
	path: string;
	source: ComposeSource;
	sha256: string;
	overridden: boolean;
}

async function request(body: Record<string, unknown>): Promise<unknown> {
	const token = await getIdToken();
	if (!token) throw new Error("Not authenticated");
	const res = await fetch(`${API_URL}/api/workspaces/files`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(body),
	});
	const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
	if (!res.ok || data.ok === false) {
		throw new Error(
			`Workspace API: ${res.status} ${data.error ?? res.statusText}`,
		);
	}
	return data;
}

export async function listWorkspaceFiles(
	target: Target,
): Promise<{ files: WorkspaceFileMeta[] }> {
	return (await request({ action: "list", ...target })) as {
		files: WorkspaceFileMeta[];
	};
}

export async function getWorkspaceFile(
	target: Target,
	path: string,
): Promise<{ content: string | null; source: ComposeSource; sha256: string }> {
	return (await request({ action: "get", ...target, path })) as {
		content: string | null;
		source: ComposeSource;
		sha256: string;
	};
}

export async function putWorkspaceFile(
	target: Target,
	path: string,
	content: string,
	opts: { acceptTemplateUpdate?: boolean } = {},
): Promise<void> {
	await request({
		action: "put",
		...target,
		path,
		content,
		...(opts.acceptTemplateUpdate ? { acceptTemplateUpdate: true } : {}),
	});
}

export async function deleteWorkspaceFile(
	target: Target,
	path: string,
): Promise<void> {
	await request({ action: "delete", ...target, path });
}

export async function regenerateWorkspaceMap(agentId: string): Promise<void> {
	await request({ action: "regenerate-map", agentId });
}

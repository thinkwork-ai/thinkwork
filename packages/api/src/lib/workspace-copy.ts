/**
 * Copy workspace files between S3 prefixes.
 * Used by PRD-30C: Agent Catalog.
 *
 * Copy chain:
 *   defaults → template (on template creation)
 *   template → agent   (on "Use Template")
 */

import {
	S3Client,
	ListObjectsV2Command,
	CopyObjectCommand,
	PutObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
	region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const BUCKET = process.env.WORKSPACE_BUCKET || "";

// ---------------------------------------------------------------------------
// Default workspace file content (same as frontend bootstrap)
// ---------------------------------------------------------------------------

const DEFAULT_ROUTER = `# Workspace Router

## default
- load: SOUL.md, IDENTITY.md, USER.md
- skills: all

## chat
- load: docs/tone.md, memory/preferences.md
- skills: all

## email
- load: docs/procedures/
- skills: agent-email-send

## heartbeat
- load: docs/procedures/
- skip: IDENTITY.md, USER.md
- skills: ticket-management
`;

const DEFAULT_FILES: Record<string, string> = {
	// --- Memory Templates (packages/memory-templates/) ---
	"SOUL.md": `You are a helpful, knowledgeable AI assistant. You communicate clearly and concisely, adapting your tone to the context of each conversation. You are honest about what you know and don't know.

You prioritize accuracy over speed. When uncertain, you say so rather than guessing. You ask clarifying questions when a request is ambiguous.

You respect the user's time — lead with the answer, then provide supporting detail only when it adds value.
`,
	"IDENTITY.md": `# Identity

Your name is **{{AGENT_NAME}}**. You are an AI agent powered by Thinkwork.

You assist users by answering questions, completing tasks, and providing thoughtful guidance. When introducing yourself or referring to yourself, use your name.
`,
	"USER.md": `# User Context

Your primary human partner is **{{HUMAN_NAME}}**. Adapt your responses to their needs — be concise for simple questions and thorough for complex ones.

When you don't know the user's preferences yet, default to a professional but friendly tone.
`,
	"TOOLS.md": `## Tool Usage Policy

You have access to specialized tools. You MUST use them proactively:

- **Never tell the user to search, check a website, or look something up themselves.** If you have a tool that can retrieve the information, use it.
- **Always prefer tool-sourced answers** over training data for anything time-sensitive: current events, recent dates, prices, schedules, availability, weather, or any factual claim that may have changed since your training cutoff.
- **When uncertain whether information is current**, use your tools to verify before responding.
- **Call tools first, then respond.** Do not apologize for limitations you can overcome with a tool call.
`,
	// --- System Workspace (packages/system-workspace/) ---
	"PLATFORM.md": `# Thinkwork Platform Rules

## Tool Response Handling
When tools return structured data, write a natural language summary of the results.
The structured data is automatically rendered as rich UI components in the client —
you do NOT need to include the raw JSON in your response. Focus on providing
context, recommendations, and follow-up questions in plain text.

## Date Context
Current date and timezone are provided at the top of your context.
Use this for scheduling, deadlines, and time-relative references.

## Escalation
If you are unable to complete a task after reasonable attempts, use the
escalate_thread tool to route to your supervisor. Do not silently fail
or fabricate results.

## Memory
You have two memory systems:
- **Long-term memory** — tool names depend on your memory engine configuration.
  Default (managed): \`remember\` / \`recall\` / \`forget\`.
  Opt-in (Hindsight): \`hindsight_retain\` / \`hindsight_recall\` / \`hindsight_reflect\`.
  See MEMORY_GUIDE.md for details.
- **Workspace notes** (memory/ folder) — Use workspace file tools for structured
  working notes, contact lists, and procedural knowledge.
  Only write to files under memory/. Do not modify other workspace files.

## Communication
- Be clear and concise in your responses.
- When you don't know something, say so rather than guessing.
- When a task is complete, confirm what was done.
- When a task fails, explain what happened and suggest next steps.
`,
	"CAPABILITIES.md": `# Platform Capabilities

## Thread Management
You have access to thread management tools for creating, updating, and tracking work items.
Use these to organize your work and communicate status to humans and other agents.

## Email
If email capability is enabled, you can send and receive email on behalf of your organization.
Always use professional tone in outgoing email unless your workspace style guide says otherwise.

## Knowledge Bases
If knowledge bases are assigned to you, use the knowledge_base_search tool to find relevant
information from uploaded documents before answering questions about company policies,
procedures, or reference material.

## Web Search
If web search is available, use it to find current information when your training data
may be outdated or when the question requires real-time data.

## Calendar
If calendar tools are available, use them to check availability and schedule meetings.
Always confirm time zones when scheduling across regions.
`,
	"GUARDRAILS.md": `# Safety Guardrails

## Confidentiality
- Never share one tenant's information with another tenant.
- Never share one client's information with another client.
- If asked about other organizations, users, or agents outside your scope, decline.

## Data Handling
- Do not store sensitive data (passwords, API keys, credit card numbers) in workspace
  memory files or thread comments.
- If you receive sensitive data in a message, process it but do not echo it back
  unnecessarily.

## Authorization Boundaries
- Only perform actions within the scope of tools available to you.
- Do not attempt to access systems or data you are not authorized to use.
- If a user requests something outside your capabilities, explain what you can do
  and suggest alternatives.

## Human Escalation
- Escalate when you are uncertain about a decision with significant consequences.
- Escalate when a task requires human judgment (legal, financial, personnel decisions).
- Escalate when you detect potential safety or compliance concerns.
- Use the escalate_thread tool rather than silently failing.
`,
	"MEMORY_GUIDE.md": `# Memory System

You have persistent long-term memory that spans all conversations. AgentCore managed memory is **always on** — the platform automatically retains every turn into long-term memory in the background. You do NOT need to call \`remember()\` for routine facts. The managed memory tools (\`remember\`, \`recall\`, \`forget\`) are always available. When Hindsight is enabled as an add-on, you also get \`hindsight_retain\`, \`hindsight_recall\`, and \`hindsight_reflect\` for advanced semantic + graph retrieval.

## Automatic retention (always on)

After every turn, the platform emits an event containing both the user message and your response into AgentCore Memory. Background strategies extract facts into four namespaces:

- **semantic** — facts about the user, their projects, and their context
- **preferences** — user-stated preferences and standing instructions
- **summaries** — rolling session summaries
- **episodes** — remembered events and prior interactions

You never need to trigger this — it happens automatically after your turn completes. Assume the facts you learn in one conversation will be available via \`recall()\` in future conversations.

## Managed memory tools (always available)

- **remember(fact, category)** — Store an explicit memory when the user *specifically asks you to remember something*. Also usable for critical durable facts you want immediately searchable before the background strategies catch up. Do NOT call this on every turn — automatic retention already handles that.
- **recall(query, scope, strategy)** — Search long-term memory.
  - \`scope\`: \`memory\` (default), \`all\`, \`knowledge\`, or \`graph\`.
  - \`strategy\`: optional filter — \`semantic\`, \`preferences\`, \`episodes\`, or empty for all.
- **forget(query)** — Archive a memory by searching for it semantically. Archived memories are permanently deleted after 30 days.

## Hindsight add-on tools (when enabled)

When your deployment has Hindsight enabled, you ALSO have these tools alongside the managed ones:

- **hindsight_retain(content)** — Store facts, preferences, or instructions to Hindsight. The \`remember()\` tool dual-writes to both backends, so you only need to call this directly when you want Hindsight-only storage.
- **hindsight_recall(query)** — Search Hindsight memory using multi-strategy retrieval (semantic + BM25 + entity graph + temporal) with cross-encoder reranking. Use this for factual questions about people, companies, and projects.
- **hindsight_reflect(query)** — Synthesize a reasoned answer from many stored memories at once. More expensive — prefer recall for simple lookups, reflect for narrative synthesis.

## When to call remember() explicitly

Automatic retention handles most of this. Only call \`remember()\` when:

- The user literally asks you to remember something ("remember that...")
- A critical fact came up that you want searchable immediately

**Do NOT call remember() to journal every turn** — that is handled automatically.

## When to Recall

- At the start of a new topic to check for relevant context
- When the user references something from a past conversation
- Before making assumptions — check if you already know the user's preference
- When a task would benefit from historical context
`,
	"ROUTER.md": DEFAULT_ROUTER,
	// --- Working Memory ---
	"memory/lessons.md": "# Lessons Learned\n\nThings this agent has learned across conversations.\n",
	"memory/preferences.md": "# Preferences\n\nDiscovered user and team preferences.\n",
	"memory/contacts.md": "# Contacts\n\nKey people and their roles.\n",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveTenantSlug(tenantId: string): Promise<string> {
	const { db, eq, tenants } = await import("../graphql/utils.js");
	const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
	if (!tenant?.slug) throw new Error(`Tenant ${tenantId} not found or has no slug`);
	return tenant.slug;
}

async function copyS3Prefix(srcPrefix: string, dstPrefix: string): Promise<number> {
	let copied = 0;
	let continuationToken: string | undefined;

	do {
		const list = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: srcPrefix,
				ContinuationToken: continuationToken,
			}),
		);

		for (const obj of list.Contents || []) {
			if (!obj.Key) continue;
			const relativePath = obj.Key.slice(srcPrefix.length);
			if (!relativePath) continue;

			await s3.send(
				new CopyObjectCommand({
					Bucket: BUCKET,
					CopySource: `${BUCKET}/${obj.Key}`,
					Key: `${dstPrefix}${relativePath}`,
				}),
			);
			copied++;
		}

		continuationToken = list.NextContinuationToken;
	} while (continuationToken);

	return copied;
}

async function ensureDefaultsExist(tenantSlug: string): Promise<void> {
	const prefix = `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
	const list = await s3.send(
		new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1 }),
	);
	if ((list.Contents?.length ?? 0) > 0) return; // already seeded

	// Seed default files
	for (const [path, content] of Object.entries(DEFAULT_FILES)) {
		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET,
				Key: `${prefix}${path}`,
				Body: content,
				ContentType: "text/markdown",
			}),
		);
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Copy default workspace files to a new template.
 * Auto-seeds defaults if they don't exist yet.
 * Source: tenants/{tenantSlug}/agent-catalog/defaults/workspace/
 * Dest:   tenants/{tenantSlug}/agent-catalog/{templateSlug}/workspace/
 */
export async function copyDefaultsToTemplate(
	tenantId: string,
	templateSlug: string,
): Promise<number> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	await ensureDefaultsExist(tenantSlug);
	const srcPrefix = `tenants/${tenantSlug}/agents/_catalog/defaults/workspace/`;
	const dstPrefix = `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
	return copyS3Prefix(srcPrefix, dstPrefix);
}

/**
 * Copy template workspace files to a new agent.
 * Source: tenants/{tenantSlug}/agent-catalog/{templateSlug}/workspace/
 * Dest:   tenants/{tenantSlug}/agents/{agentSlug}/workspace/
 */
export async function copyTemplateWorkspace(
	tenantId: string,
	templateSlug: string,
	agentSlug: string,
): Promise<number> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	const srcPrefix = `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
	const dstPrefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;

	const copied = await copyS3Prefix(srcPrefix, dstPrefix);

	if (copied > 0) {
		const { regenerateManifest } = await import("./workspace-manifest.js");
		await regenerateManifest(BUCKET, tenantSlug, agentSlug);
	}

	return copied;
}

/**
 * Overlay class workspace files onto an existing agent workspace.
 *
 * Unlike copyTemplateWorkspace (which assumes a fresh target), this is meant
 * for sync scenarios where the agent already has files:
 *   - Files in the class are copied to the agent, overwriting matching paths.
 *   - Files present on the agent but not on the class are LEFT ALONE (preserves
 *     per-agent additions).
 *
 * Returns the number of files overlaid.
 */
export async function overlayTemplateWorkspace(
	tenantId: string,
	templateSlug: string,
	agentSlug: string,
): Promise<number> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	const srcPrefix = `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
	const dstPrefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;

	const copied = await copyS3Prefix(srcPrefix, dstPrefix);

	if (copied > 0) {
		const { regenerateManifest } = await import("./workspace-manifest.js");
		await regenerateManifest(BUCKET, tenantSlug, agentSlug);
	}

	return copied;
}

/**
 * List file paths under a template workspace (relative to workspace root).
 * Used by templateSyncDiff to compare against agent workspace.
 */
export async function listTemplateFiles(
	tenantId: string,
	templateSlug: string,
): Promise<string[]> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	const prefix = `tenants/${tenantSlug}/agents/_catalog/${templateSlug}/workspace/`;
	return listWorkspaceFilePaths(prefix);
}

/**
 * List file paths under an agent workspace (relative to workspace root).
 */
export async function listAgentFiles(
	tenantId: string,
	agentSlug: string,
): Promise<string[]> {
	const tenantSlug = await resolveTenantSlug(tenantId);
	const prefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
	return listWorkspaceFilePaths(prefix);
}

async function listWorkspaceFilePaths(prefix: string): Promise<string[]> {
	const paths: string[] = [];
	let continuationToken: string | undefined;
	do {
		const list = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const obj of list.Contents || []) {
			if (!obj.Key) continue;
			const rel = obj.Key.slice(prefix.length);
			if (!rel || rel === "manifest.json") continue;
			paths.push(rel);
		}
		continuationToken = list.NextContinuationToken;
	} while (continuationToken);
	return paths;
}

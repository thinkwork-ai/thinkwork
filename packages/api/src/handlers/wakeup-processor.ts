/**
 * Wakeup Processor Lambda
 *
 * Runs on a 30-second EventBridge schedule. Polls `agent_wakeup_requests`
 * for queued work, claims it, creates a `scheduled_job_runs` record, dispatches
 * to AgentCore (or handles chat inline), and records the outcome.
 *
 * This is the **single execution path** for all agent invocations — chat,
 * timer heartbeats, thread assignment, comment triggers, approval decisions,
 * and on-demand wakeups all flow through here.
 */

import { randomBytes } from "crypto";
import { eq, and, sql, asc, desc } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	agentWakeupRequests,
	threadTurns,
	threadTurnEvents,
	threads,
	agents,
	agentTemplates,
	agentSkills,
	tenantSkills,
	agentKnowledgeBases,
	knowledgeBases,
	guardrails,
	messages,
	artifacts,
	tenants,
	users,
	costEvents,
	tenantMcpServers,
	agentMcpServers,
} from "@thinkwork/database-pg/schema";
import {
	extractUsage,
	recordCostEvents,
	checkBudgetAndPause,
	notifyCostRecorded,
} from "../lib/cost-recording.js";
import { buildSkillEnvOverrides, resolveOAuthToken } from "../lib/oauth-token.js";
import { ensureThreadForWork } from "../lib/thread-helpers.js";
import { isThreadBlocked, checkConcurrencyLimits } from "../lib/thread-dispatch.js";
import { promoteNextDeferredWakeup } from "../lib/wakeup-defer.js";
import { resolveWorkflowConfig, renderPromptTemplate } from "../lib/orchestration/index.js";
import type { PromptTemplateContext } from "../lib/orchestration/index.js";

const AGENTCORE_INVOKE_URL = process.env.AGENTCORE_INVOKE_URL || "";
const AGENTCORE_FUNCTION_NAME = process.env.AGENTCORE_FUNCTION_NAME || "";
const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT || "";
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY || "";
const MANIFLOW_API_SECRET = process.env.MANIFLOW_API_SECRET || "";
const MCP_BASE_URL = process.env.MCP_BASE_URL || "";
const MCP_AUTH_SECRET = process.env.MCP_AUTH_SECRET || "";
const AGENTCORE_GATEWAY_URL = process.env.AGENTCORE_GATEWAY_URL || "";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET || "";
const MANIFLOW_API_URL = process.env.MANIFLOW_API_URL || process.env.MCP_BASE_URL || "";
const EXA_API_KEY = process.env.EXA_API_KEY || "";
const HINDSIGHT_ENDPOINT = process.env.HINDSIGHT_ENDPOINT || "";
const BATCH_SIZE = 10;

/**
 * Invoke AgentCore via Lambda SDK (direct invoke) or HTTP fetch (Function URL).
 * Uses AGENTCORE_FUNCTION_NAME for Lambda SDK, falls back to AGENTCORE_INVOKE_URL for HTTP.
 */
async function invokeAgentCore(payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; result: Record<string, unknown> }> {
	if (AGENTCORE_FUNCTION_NAME) {
		const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
		const lambda = new LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
		const lambdaPayload = JSON.stringify({
			requestContext: { http: { method: "POST", path: "/invocations" } },
			rawPath: "/invocations",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
			isBase64Encoded: false,
		});
		const resp = await lambda.send(new InvokeCommand({
			FunctionName: AGENTCORE_FUNCTION_NAME,
			InvocationType: "RequestResponse",
			Payload: new TextEncoder().encode(lambdaPayload),
		}));
		const respBody = resp.Payload ? new TextDecoder().decode(resp.Payload) : "{}";
		const parsed = JSON.parse(respBody) as Record<string, unknown>;
		// Lambda Web Adapter returns {statusCode, body, headers}
		const statusCode = (parsed.statusCode as number) || 200;
		const bodyStr = (parsed.body as string) || respBody;
		const result = JSON.parse(bodyStr) as Record<string, unknown>;
		return { ok: statusCode >= 200 && statusCode < 300, status: statusCode, result };
	}

	// Fallback to HTTP fetch
	const resp = await fetch(AGENTCORE_INVOKE_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(MANIFLOW_API_SECRET ? { Authorization: `Bearer ${MANIFLOW_API_SECRET}` } : {}),
		},
		body: JSON.stringify(payload),
	});
	if (!resp.ok) {
		const errText = await resp.text();
		return { ok: false, status: resp.status, result: { error: errText } };
	}
	const result = await resp.json() as Record<string, unknown>;
	return { ok: true, status: 200, result };
}

const db = getDb();

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handler(): Promise<{ processed: number; errors: number }> {
	let processed = 0;
	let errors = 0;

	// 1. Fetch queued wakeup requests (oldest first)
	const queued = await db
		.select()
		.from(agentWakeupRequests)
		.where(eq(agentWakeupRequests.status, "queued"))
		.orderBy(asc(agentWakeupRequests.created_at))
		.limit(BATCH_SIZE);

	if (queued.length === 0) return { processed: 0, errors: 0 };

	console.log(`[wakeup-processor] Found ${queued.length} queued wakeup requests`);

	for (const wakeup of queued) {
		try {
			await processWakeup(wakeup);
			processed++;
		} catch (err) {
			errors++;
			console.error(`[wakeup-processor] Failed to process wakeup ${wakeup.id}:`, err);
			// Mark as failed
			await db
				.update(agentWakeupRequests)
				.set({ status: "failed", finished_at: new Date() })
				.where(eq(agentWakeupRequests.id, wakeup.id));
		}
	}

	console.log(`[wakeup-processor] Done: processed=${processed} errors=${errors}`);
	return { processed, errors };
}

// ---------------------------------------------------------------------------
// Process a single wakeup request
// ---------------------------------------------------------------------------

interface WakeupRow {
	id: string;
	tenant_id: string;
	agent_id: string;
	source: string;
	trigger_detail: string | null;
	reason: string | null;
	payload: unknown;
	status: string;
}

async function processWakeup(wakeup: WakeupRow): Promise<void> {
	const now = new Date();

	// 2. Atomically claim — only succeed if still queued
	const [claimed] = await db
		.update(agentWakeupRequests)
		.set({ status: "claimed", claimed_at: now })
		.where(
			and(
				eq(agentWakeupRequests.id, wakeup.id),
				eq(agentWakeupRequests.status, "queued"),
			),
		)
		.returning();

	if (!claimed) {
		console.log(`[wakeup-processor] Wakeup ${wakeup.id} already claimed, skipping`);
		return;
	}

	// 3. Look up agent + its template (model, guardrail, blocked tools all live on agent_templates)
	const [agent] = await db
		.select({
			adapter_type: agents.adapter_type,
			model: agentTemplates.model,
			name: agents.name,
			slug: agents.slug,
			human_pair_id: agents.human_pair_id,
			runtime_config: agents.runtime_config,
			budget_paused: agents.budget_paused,
			guardrail_id: agentTemplates.guardrail_id,
			blocked_tools: agentTemplates.blocked_tools,
		})
		.from(agents)
		.leftJoin(agentTemplates, eq(agents.template_id, agentTemplates.id))
		.where(eq(agents.id, wakeup.agent_id));

	if (!agent) {
		console.error(`[wakeup-processor] Agent not found: ${wakeup.agent_id}`);
		await failWakeup(wakeup.id, "Agent not found");
		return;
	}

	// PRD-02: Pre-invocation budget gate
	if (agent.budget_paused) {
		console.log(`[wakeup-processor] Agent ${wakeup.agent_id} is budget-paused, skipping`);
		await failWakeup(wakeup.id, "Agent paused: budget exceeded");
		return;
	}

	// Look up tenant slug for workspace path
	const [tenant] = await db
		.select({ slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, wakeup.tenant_id));
	const tenantSlug = tenant?.slug || "";
	const agentSlug = agent.slug || "";

	// Look up human pair name for personality file bootstrap
	let humanName = "";
	if (agent.human_pair_id) {
		const [human] = await db
			.select({ name: users.name })
			.from(users)
			.where(eq(users.id, agent.human_pair_id));
		humanName = human?.name || "";
	}

	// Resolve Bedrock guardrail: class-level → tenant default → none
	let guardrailPayload: { guardrailIdentifier: string; guardrailVersion: string } | undefined;
	if (agent.guardrail_id) {
		const [gr] = await db
			.select({
				bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
				bedrock_version: guardrails.bedrock_version,
			})
			.from(guardrails)
			.where(eq(guardrails.id, agent.guardrail_id));
		if (gr?.bedrock_guardrail_id && gr?.bedrock_version) {
			guardrailPayload = {
				guardrailIdentifier: gr.bedrock_guardrail_id,
				guardrailVersion: gr.bedrock_version,
			};
		}
	} else {
		const [defaultGr] = await db
			.select({
				bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
				bedrock_version: guardrails.bedrock_version,
			})
			.from(guardrails)
			.where(and(eq(guardrails.tenant_id, wakeup.tenant_id), eq(guardrails.is_default, true)));
		if (defaultGr?.bedrock_guardrail_id && defaultGr?.bedrock_version) {
			guardrailPayload = {
				guardrailIdentifier: defaultGr.bedrock_guardrail_id,
				guardrailVersion: defaultGr.bedrock_version,
			};
		}
	}

	const blockedTools: string[] = (agent.blocked_tools as string[] | null) || [];

	// Look up agent's installed skills → build S3 keys for runtime
	// JOIN tenant_skills to determine source: catalog/builtin → skills/catalog/, tenant-custom → tenants/{slug}/skills/
	const skillRows = await db
		.select({
			skill_id: agentSkills.skill_id,
			config: agentSkills.config,
			source: tenantSkills.source,
		})
		.from(agentSkills)
		.leftJoin(tenantSkills, and(
			eq(tenantSkills.tenant_id, wakeup.tenant_id),
			eq(tenantSkills.skill_id, agentSkills.skill_id),
		))
		.where(eq(agentSkills.agent_id, wakeup.agent_id));

	let skillsConfig = await Promise.all(skillRows.map(async (s) => {
		const config = (s.config as Record<string, unknown>) || {};
		const envOverrides = await buildSkillEnvOverrides(config, wakeup.tenant_id).catch((err) => {
			console.warn(`[wakeup-processor] envOverrides failed for skill ${s.skill_id}:`, err);
			return null;
		});
		const isTenantCustom = s.source === "tenant";
		const s3Key = isTenantCustom
			? `tenants/${tenantSlug}/skills/${s.skill_id}`
			: `skills/catalog/${s.skill_id}`;
		const merged: Record<string, string> = envOverrides ? { ...envOverrides } : {};
		if (s.skill_id === "web-search" && EXA_API_KEY) merged.EXA_API_KEY = EXA_API_KEY;
		return {
			skillId: s.skill_id,
			s3Key,
			secretRef: config.secretRef as string || undefined,
			envOverrides: Object.keys(merged).length > 0 ? merged : undefined,
			mcpServer: config.mcpServer as string || undefined,
		};
	}));

	const payload = wakeup.payload as Record<string, unknown> | null;

	// PRD-14: Auto-inject agent-email-send skill for email_received wakeups
	if (wakeup.source === "email_received") {
		const { agentCapabilities } = await import("@thinkwork/database-pg/schema");
		const [emailCap] = await db
			.select({ config: agentCapabilities.config })
			.from(agentCapabilities)
			.where(
				and(
					eq(agentCapabilities.agent_id, wakeup.agent_id),
					eq(agentCapabilities.capability, "email_channel"),
				),
			);
		if (emailCap) {
			const emailConfig = (emailCap.config as Record<string, unknown>) || {};
			const vanity = emailConfig.vanityAddress ? `${emailConfig.vanityAddress}@agents.thinkwork.ai` : null;
			const emailAddress = vanity || (emailConfig.emailAddress as string) || `${agentSlug}@agents.thinkwork.ai`;
			const hasEmailSkill = skillsConfig.some((s) => s.skillId === "agent-email-send");
			if (!hasEmailSkill) {
				skillsConfig.push({
					skillId: "agent-email-send",
					s3Key: "skills/catalog/agent-email-send",
					secretRef: undefined,
					mcpServer: undefined,
					envOverrides: {
						AGENT_EMAIL_ADDRESS: emailAddress,
						AGENT_ID: wakeup.agent_id,
						MANIFLOW_API_URL: MCP_BASE_URL,
						MANIFLOW_API_SECRET: MANIFLOW_API_SECRET,
						INBOUND_MESSAGE_ID: (payload?.originalMessageId as string) || "",
						INBOUND_SUBJECT: (payload?.subject as string) || "",
						INBOUND_FROM: (payload?.from as string) || "",
						INBOUND_BODY: (payload?.body as string) || "",
					},
				});
			}
		}
	}

	// Default skill: agent-email-send — always available for all agents
	const hasEmailSendSkill = skillsConfig.some((s) => s.skillId === "agent-email-send");
	if (!hasEmailSendSkill) {
		skillsConfig.push({
			skillId: "agent-email-send",
			s3Key: "skills/catalog/agent-email-send",
			secretRef: undefined,
			envOverrides: {
				AGENT_EMAIL_ADDRESS: `${agentSlug}@agents.thinkwork.ai`,
				AGENT_ID: wakeup.agent_id,
				MANIFLOW_API_URL: MANIFLOW_API_URL,
				MANIFLOW_API_SECRET: MANIFLOW_API_SECRET,
				INBOUND_MESSAGE_ID: "",
				INBOUND_SUBJECT: "",
				INBOUND_FROM: "",
				INBOUND_BODY: "",
			},
			mcpServer: undefined,
		});
	}

	// Default skills: always available for all agents (parity with chat-agent-invoke)
	const defaultSkills = [
		{ skillId: "agent-thread-management", s3Key: "skills/catalog/agent-thread-management" },
		{ skillId: "web-search", s3Key: "skills/catalog/web-search" },
		{ skillId: "artifacts", s3Key: "skills/catalog/artifacts" },
		{ skillId: "workspace-memory", s3Key: "skills/catalog/workspace-memory" },
	];
	for (const ds of defaultSkills) {
		if (!skillsConfig.some((s) => s.skillId === ds.skillId)) {
			const env: Record<string, string> = {
				MANIFLOW_API_URL: MANIFLOW_API_URL,
				MANIFLOW_API_SECRET: MANIFLOW_API_SECRET,
				GRAPHQL_API_KEY: APPSYNC_API_KEY,
				AGENT_ID: wakeup.agent_id,
			};
			if (ds.skillId === "web-search" && EXA_API_KEY) env.EXA_API_KEY = EXA_API_KEY;
			skillsConfig.push({
				...ds,
				secretRef: undefined,
				envOverrides: env,
				mcpServer: undefined,
			});
		}
	}

	// Apply class tool_access policy — remove blocked skills
	if (blockedTools.length > 0) {
		const before = skillsConfig.length;
		skillsConfig = skillsConfig.filter((s) => !blockedTools.includes(s.skillId));
		const removed = before - skillsConfig.length;
		if (removed > 0) {
			console.log(`[wakeup-processor] Class tool_access: removed ${removed} blocked skill(s)`);
		}
	}

	// Look up agent's assigned knowledge bases (PRD-13)
	const kbRows = await db
		.select({
			aws_kb_id: knowledgeBases.aws_kb_id,
			name: knowledgeBases.name,
			description: knowledgeBases.description,
			search_config: agentKnowledgeBases.search_config,
		})
		.from(agentKnowledgeBases)
		.innerJoin(knowledgeBases, eq(agentKnowledgeBases.knowledge_base_id, knowledgeBases.id))
		.where(and(
			eq(agentKnowledgeBases.agent_id, wakeup.agent_id),
			eq(agentKnowledgeBases.enabled, true),
		))
		.then((rows) => rows.filter((r) => r.aws_kb_id));

	const knowledgeBasesConfig = kbRows.length > 0
		? kbRows.map((kb) => ({
			awsKbId: kb.aws_kb_id,
			name: kb.name,
			description: kb.description,
			searchConfig: kb.search_config,
		}))
		: undefined;

	const runtimeType = "strands"; // All agents use Strands (SDK deprecated)

	// 4. Create trigger_run record
	// Extract trigger_id from trigger_detail if present (e.g. "manual_fire:trigger:UUID" or "schedule:job-XXX")
	let triggerId: string | null = null;
	if (payload?.triggerId) {
		triggerId = String(payload.triggerId);
	} else if (wakeup.trigger_detail) {
		const triggerMatch = wakeup.trigger_detail.match(/trigger:([0-9a-f-]{36})/);
		if (triggerMatch) triggerId = triggerMatch[1];
	}

	// Look up trigger name for notifications
	let triggerName: string | null = null;
	if (triggerId) {
		const { triggers } = await import("@thinkwork/database-pg/schema");
		const [trig] = await db.select({ name: triggers.name }).from(triggers).where(eq(triggers.id, triggerId));
		triggerName = trig?.name ?? null;
	}

	// PRD-15: Resolve thread_id for this turn
	let runThreadId = String(payload?.threadId || "") || undefined;

	// Fallback: if no thread was provided (e.g., job-trigger failed to create one), create one now
	if (!runThreadId && wakeup.agent_id && (wakeup.source === "trigger" || wakeup.source === "on_demand" || wakeup.source === "timer")) {
		try {
			const triggerName = String(payload?.triggerId || wakeup.trigger_detail || "").slice(0, 8);
			const result = await ensureThreadForWork({
				tenantId: wakeup.tenant_id,
				agentId: wakeup.agent_id,
				title: agent.name ? `${agent.name} — ${triggerName}` : `Scheduled run ${triggerName}`,
				channel: "schedule",
			});
			runThreadId = result.threadId;
			console.log(`[wakeup-processor] Created fallback thread ${result.identifier} for wakeup ${wakeup.id}`);
		} catch (err) {
			console.warn("[wakeup-processor] Failed to create fallback thread:", err);
		}
	}

	let turnNumber: number | undefined;
	if (runThreadId) {
		try {
			const [c] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(threadTurns).where(eq(threadTurns.thread_id, runThreadId));
			turnNumber = (c?.count || 0) + 1;
		} catch {}
	}

	// PRD-09 §9.1.6: Skip if thread is blocked by unresolved dependencies
	if (runThreadId) {
		try {
			const blocked = await isThreadBlocked(runThreadId);
			if (blocked) {
				console.log(`[wakeup-processor] Thread ${runThreadId} is blocked by dependencies, skipping wakeup ${wakeup.id}`);
				await db.insert(threadTurns).values({
					tenant_id: wakeup.tenant_id,
					agent_id: wakeup.agent_id,
					trigger_id: triggerId,
					wakeup_request_id: wakeup.id,
					invocation_source: wakeup.source,
					trigger_detail: wakeup.trigger_detail,
					status: "skipped",
					started_at: now,
					finished_at: now,
					error: "blocked_by_dependencies",
					thread_id: runThreadId,
					turn_number: turnNumber,
				});
				await db.update(agentWakeupRequests)
					.set({ status: "skipped", finished_at: now })
					.where(eq(agentWakeupRequests.id, wakeup.id));
				return;
			}
		} catch (err) {
			console.warn("[wakeup-processor] Blocking check failed, proceeding:", err);
		}
	}

	// PRD-09 §9.3.3: Concurrency gate — skip thread_assignment wakeups at capacity
	// Never block chat_message wakeups
	if (wakeup.source === "thread_assignment" || wakeup.source === "automation") {
		try {
			const concurrencyResult = await checkConcurrencyLimits(wakeup.tenant_id, wakeup.agent_id);
			if (!concurrencyResult.allowed) {
				console.log(`[wakeup-processor] Concurrency limit reached for agent ${wakeup.agent_id}: ${concurrencyResult.reason}, skipping wakeup ${wakeup.id}`);
				await db.insert(threadTurns).values({
					tenant_id: wakeup.tenant_id,
					agent_id: wakeup.agent_id,
					trigger_id: triggerId,
					wakeup_request_id: wakeup.id,
					invocation_source: wakeup.source,
					trigger_detail: wakeup.trigger_detail,
					status: "skipped",
					started_at: now,
					finished_at: now,
					error: `concurrency_limit: ${concurrencyResult.reason}`,
					thread_id: runThreadId,
					turn_number: turnNumber,
				});
				await db.update(agentWakeupRequests)
					.set({ status: "skipped", finished_at: now })
					.where(eq(agentWakeupRequests.id, wakeup.id));
				return;
			}
		} catch (err) {
			console.warn("[wakeup-processor] Concurrency check failed, proceeding:", err);
		}
	}

	// PRD-09 §9.4.2: Auto-inject agent-thread-management skill for orchestration-enabled agents
	const orchConfig = ((agent.runtime_config as Record<string, unknown>) || {}).orchestration as Record<string, unknown> | undefined;
	if (orchConfig?.threadManagement && runThreadId) {
		const hasThreadSkill = skillsConfig.some((s) => s.skillId === "agent-thread-management");
		if (!hasThreadSkill) {
			skillsConfig.push({
				skillId: "agent-thread-management",
				s3Key: "skills/catalog/agent-thread-management",
				secretRef: undefined,
				mcpServer: undefined,
				envOverrides: {
					MANIFLOW_API_URL: APPSYNC_ENDPOINT,
					MANIFLOW_API_SECRET: APPSYNC_API_KEY,
					AGENT_ID: wakeup.agent_id,
					TENANT_ID: wakeup.tenant_id,
					CURRENT_THREAD_ID: runThreadId,
				},
			});
		}
	}

	// PRD-22: Process template materialization
	// On first wakeup for a process-enabled skill, materialize the template into sub-threads.
	if (runThreadId) {
		const processSkill = skillsConfig.find((s) => {
			const cfg = skillRows.find((r) => r.skill_id === s.skillId)?.config as Record<string, unknown> | undefined;
			return cfg?.process === true;
		});

		if (processSkill) {
			// Check if already materialized (has children = not first wakeup)
			const [childCount] = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(threads)
				.where(eq(threads.parent_id, runThreadId));

			if ((childCount?.count || 0) === 0) {
				try {
					const { parseProcessTemplate } = await import("../lib/orchestration/process-parser.js");
					const { materializeProcess } = await import("../lib/orchestration/process-materializer.js");
					const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");

					const s3 = new S3Client({});
					const skillCfg = skillRows.find((r) => r.skill_id === processSkill.skillId)?.config as Record<string, unknown> | undefined;
					const triggerChannel = skillCfg?.trigger_channel as string | undefined;

					// Try tenant override first, then catalog default
					let processMarkdown: string | null = null;
					const s3Paths = [
						`tenants/${tenantSlug}/skills/${processSkill.skillId}/PROCESS.md`,
						`skills/catalog/${processSkill.skillId}/PROCESS.md`,
					];

					for (const s3Path of s3Paths) {
						try {
							const resp = await s3.send(new GetObjectCommand({
								Bucket: WORKSPACE_BUCKET,
								Key: s3Path,
							}));
							processMarkdown = await resp.Body?.transformToString() || null;
							if (processMarkdown) break;
						} catch { /* try next path */ }
					}

					if (processMarkdown) {
						const template = parseProcessTemplate(processMarkdown);
						await materializeProcess({
							template,
							parentThreadId: runThreadId,
							agentId: wakeup.agent_id,
							tenantId: wakeup.tenant_id,
						});
						console.log(`[wakeup-processor] Process template materialized for thread ${runThreadId}`);
					} else {
						console.warn(`[wakeup-processor] No PROCESS.md found for skill ${processSkill.skillId}`);
					}
				} catch (err) {
					console.error(`[wakeup-processor] Process materialization failed:`, err);
				}
			}
		}
	}

	// PRD-09 §9.2.6: Carry retry metadata if this is a retry wakeup
	const retryAttempt = (payload?.retryAttempt as number) || 0;
	const originTurnId = (payload?.originTurnId as string) || undefined;

	// PRD-09 Batch 3: Resolve workflow config for turn loop + workspace isolation
	const workflowConfig = await resolveWorkflowConfig(wakeup.tenant_id);

	// PRD-09 Batch 3: Build workspace prefix with optional per-thread isolation
	let workspacePrefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
	if (workflowConfig.workspace.isolateByThread && runThreadId) {
		workspacePrefix = `tenants/${tenantSlug}/agents/${agentSlug}/threads/${runThreadId}/`;
	} else if (workflowConfig.workspace.prefixTemplate) {
		workspacePrefix = workflowConfig.workspace.prefixTemplate
			.replace("{tenantSlug}", tenantSlug)
			.replace("{agentSlug}", agentSlug);
	}

	const [run] = await db
		.insert(threadTurns)
		.values({
			tenant_id: wakeup.tenant_id,
			agent_id: wakeup.agent_id,
			trigger_id: triggerId,
			wakeup_request_id: wakeup.id,
			invocation_source: wakeup.source,
			trigger_detail: wakeup.trigger_detail,
			status: "running",
			started_at: now,
			last_activity_at: now,
			retry_attempt: retryAttempt,
			origin_turn_id: originTurnId,
			context_snapshot: wakeup.payload as Record<string, unknown> | undefined,
			thread_id: runThreadId || undefined,
			turn_number: turnNumber || undefined,
		})
		.returning();

	// Link run back to wakeup
	await db
		.update(agentWakeupRequests)
		.set({ run_id: run.id })
		.where(eq(agentWakeupRequests.id, wakeup.id));

	// Notify subscribers that a run started
	await notifyThreadTurnUpdate({
		runId: run.id,
		triggerId,
		tenantId: wakeup.tenant_id,
		threadId: runThreadId || null,
		agentId: wakeup.agent_id || null,
		status: "running",
		triggerName,
	});

	// Log start event
	await insertRunEvent(run.id, wakeup.tenant_id, wakeup.agent_id || null, 1, "started", {
		source: wakeup.source,
		reason: wakeup.reason,
	});

	// 5. Build message and invoke AgentCore
	const reason = wakeup.reason || wakeup.source;
	let agentMessage: string;

	switch (wakeup.source) {
		case "chat_message":
		case "automation": {
			// Chat message — use the user's message directly
			agentMessage = String(payload?.userMessage || payload?.message || "New message received");
			break;
		}
		case "thread_assignment": {
			let threadContext = "";
			if (runThreadId) {
				try {
					const { threads } = await import("@thinkwork/database-pg/schema");
					const [t] = await db
						.select({ title: threads.title, description: threads.description })
						.from(threads)
						.where(eq(threads.id, runThreadId));
					if (t) {
						threadContext = `\n\nThread: ${t.title}`;
						if (t.description) threadContext += `\n\n${t.description}`;
					}
				} catch (err) {
					console.warn(`[wakeup-processor] Failed to load thread context:`, err);
				}
			}
			agentMessage = `You have been assigned a thread.${threadContext}`;
			break;
		}
		case "issue_commented":
		case "issue_comment_mentioned": {
			agentMessage = `A comment was added to your thread. Comment ID: ${payload?.commentId}. Thread ID: ${payload?.threadId}. Please review and respond.`;
			break;
		}
		case "inbox_item_decided": {
			const status = payload?.status || "unknown";
			agentMessage = `An approval you requested has been ${status}. Inbox Item ID: ${payload?.inboxItemId}. Please take appropriate action.`;
			break;
		}
		case "timer":
		case "heartbeat_timer": {
			agentMessage = "Heartbeat timer triggered. Check for pending work in your thread inbox.";
			break;
		}
		case "on_demand":
		case "trigger": {
			agentMessage = String(payload?.message || "You have been manually woken up. Check for pending work.");
			break;
		}
		case "email_triage": {
			agentMessage = "Check for new inbox messages using the google-email skill, classify them, create tasks for actionable items, and post a summary.";
			break;
		}
		case "email_received": {
			const from = (payload?.from as string) || "unknown";
			const subject = (payload?.subject as string) || "(no subject)";
			const body = (payload?.body as string) || "";
			agentMessage = [
				"You received an email. Process this and respond appropriately.",
				"",
				"[EMAIL_CONTENT_START]",
				`From: ${from}`,
				`Subject: ${subject}`,
				`Body: ${body}`,
				"[EMAIL_CONTENT_END]",
				"",
				"If you need to reply, use the agent-email-send skill.",
			].join("\n");
			break;
		}
		case "webhook": {
			const webhookPayload = payload?.webhookPayload;
			const promptText = String(payload?.message || "");
			agentMessage = [
				promptText || "A webhook was triggered. Process the payload and respond appropriately.",
				"",
				"[WEBHOOK_PAYLOAD_START]",
				typeof webhookPayload === "object" ? JSON.stringify(webhookPayload, null, 2) : String(webhookPayload ?? "{}"),
				"[WEBHOOK_PAYLOAD_END]",
			].join("\n");
			break;
		}
		default: {
			agentMessage = `Wakeup triggered: ${reason || wakeup.source}`;
		}
	}

	// Load thread context — used by prompt template rendering AND trigger channel resolution
	let threadContext: PromptTemplateContext["thread"] | undefined;
	if (runThreadId) {
		try {
			const { threads } = await import("@thinkwork/database-pg/schema");
			const [threadRow] = await db
				.select({
					identifier: threads.identifier,
					title: threads.title,
					description: threads.description,
					status: threads.status,
					priority: threads.priority,
					channel: threads.channel,
					metadata: threads.metadata,
				})
				.from(threads)
				.where(eq(threads.id, runThreadId));
			if (threadRow) {
				threadContext = {
					id: runThreadId,
					identifier: threadRow.identifier || undefined,
					title: threadRow.title,
					description: threadRow.description || undefined,
					status: threadRow.status,
					priority: threadRow.priority,
					channel: threadRow.channel,
				};
			}
		} catch {}
	}

	// PRD-09 Batch 4: Render prompt template if configured
	if (workflowConfig.promptTemplate) {
		const rendered = renderPromptTemplate(workflowConfig.promptTemplate, {
			tenant: { id: wakeup.tenant_id, slug: tenantSlug },
			agent: { id: wakeup.agent_id, slug: agentSlug, name: agent.name },
			thread: threadContext,
			source: wakeup.source,
		});
		if (rendered) {
			agentMessage = `${rendered}\n\n---\n\n${agentMessage}`;
		}
	}

	// Resolve thread_id — for email_triage, use the dedicated triage thread
	let resolvedThreadId = String(payload?.threadId || "");
	if (wakeup.source === "email_triage" && !resolvedThreadId) {
		const rc = (agent.runtime_config as Record<string, unknown>) || {};
		const pc = (rc.productivityConfig as Record<string, unknown>) || {};
		resolvedThreadId = (pc.triageChatThreadId as string) || "";
	}
	if (wakeup.source === "email_received" && !resolvedThreadId) {
		const replyCtxId = payload?.replyTokenContextId as string | undefined;
		if (replyCtxId) resolvedThreadId = replyCtxId;
	}

	// Build MCP server list from agent's skills + defaults
	// Thinkwork tools route directly via MCP_BASE_URL.
	// External tools (LastMile etc.) route through Gateway (single-endpoint pattern).
	// Include all MCP servers — the container routes them appropriately:
	// Thinkwork tools → MCP_BASE_URL, LastMile tools → mcp.lastmile-tei.com
	const mcpServers = ["web-search", "artifacts"];
	for (const skill of skillsConfig) {
		if (skill.mcpServer && !mcpServers.includes(skill.mcpServer)) {
			mcpServers.push(skill.mcpServer);
		}
	}
	// Include always-available Thinkwork tools
	if (!mcpServers.includes("thread-management")) mcpServers.push("thread-management");
	if (!mcpServers.includes("email-send")) mcpServers.push("email-send");
	if (!mcpServers.includes("workspace-memory")) mcpServers.push("workspace-memory");
	// Include Google tools when the agent has those skills installed
	if (skillsConfig.some((s) => s.skillId === "google-email") && !mcpServers.includes("google-email")) {
		mcpServers.push("google-email");
	}
	if (skillsConfig.some((s) => s.skillId === "google-calendar") && !mcpServers.includes("google-calendar")) {
		mcpServers.push("google-calendar");
	}
	if (skillsConfig.some((s) => s.skillId === "restaurant-reservations") && !mcpServers.includes("restaurant")) {
		mcpServers.push("restaurant");
	}

	// Build MCP configs from agent_mcp_servers + tenant_mcp_servers.
	// Auth resolution: tenant_api_key → read token from auth_config,
	// per_user_oauth → look up human_pair's connection for the oauth_provider.
	interface McpServerConfig {
		name: string;
		url: string;
		transport: "streamable-http" | "sse";
		auth?: { type: string; token: string };
		tools?: string[];
	}
	const mcpConfigs: McpServerConfig[] = [];

	const mcpRows = await db
		.select({
			mcp_server_id: tenantMcpServers.id,
			name: tenantMcpServers.name,
			slug: tenantMcpServers.slug,
			url: tenantMcpServers.url,
			transport: tenantMcpServers.transport,
			auth_type: tenantMcpServers.auth_type,
			auth_config: tenantMcpServers.auth_config,
			server_enabled: tenantMcpServers.enabled,
			assignment_enabled: agentMcpServers.enabled,
			assignment_config: agentMcpServers.config,
		})
		.from(agentMcpServers)
		.innerJoin(tenantMcpServers, eq(agentMcpServers.mcp_server_id, tenantMcpServers.id))
		.where(and(eq(agentMcpServers.agent_id, wakeup.agent_id), eq(agentMcpServers.enabled, true)));

	for (const mcp of mcpRows) {
		if (!mcp.server_enabled) continue;

		let token: string | undefined;

		if (mcp.auth_type === "tenant_api_key") {
			const authCfg = (mcp.auth_config as Record<string, unknown>) || {};
			token = authCfg.token as string | undefined;
		} else if (mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") {
			// Look up the user's MCP token from user_mcp_tokens → Secrets Manager
			const humanPairId = agent.human_pair_id;
			if (humanPairId) {
				try {
					const { userMcpTokens } = await import("@thinkwork/database-pg/schema");
					const [userToken] = await db
						.select({ secret_ref: userMcpTokens.secret_ref, status: userMcpTokens.status })
						.from(userMcpTokens)
						.where(and(
							eq(userMcpTokens.user_id, humanPairId),
							eq(userMcpTokens.mcp_server_id, mcp.mcp_server_id),
							eq(userMcpTokens.status, "active"),
						))
						.limit(1);
					if (userToken?.secret_ref) {
						// Read token from Secrets Manager
						const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
						const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
						const secret = await sm.send(new GetSecretValueCommand({ SecretId: userToken.secret_ref }));
						if (secret.SecretString) {
							const parsed = JSON.parse(secret.SecretString);
							token = parsed.access_token;
						}
					} else {
						console.warn(`[wakeup-processor] No active MCP token for user ${humanPairId} (MCP: ${mcp.slug})`);
					}
				} catch (err) {
					console.warn(`[wakeup-processor] MCP token lookup failed for ${mcp.slug}:`, err);
				}
			}
		}

		// Only inject MCP servers where auth is fully resolved
		if (mcp.auth_type === "tenant_api_key" && !token) {
			console.warn(`[wakeup-processor] Skipping MCP ${mcp.slug}: tenant API key not configured`);
			continue;
		}
		if ((mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") && !token) {
			console.warn(`[wakeup-processor] Skipping MCP ${mcp.slug}: user has not completed OAuth`);
			continue;
		}

		const assignCfg = (mcp.assignment_config as Record<string, unknown>) || {};
		mcpConfigs.push({
			name: mcp.slug,
			url: mcp.url,
			transport: (mcp.transport as "streamable-http" | "sse") || "streamable-http",
			auth: token ? { type: "bearer", token } : undefined,
			tools: Array.isArray(assignCfg.toolAllowlist) ? assignCfg.toolAllowlist as string[] : undefined,
		});
	}
	if (mcpConfigs.length > 0) {
		console.log(`[wakeup-processor] MCP configs built: ${mcpConfigs.length} servers (${mcpConfigs.map((c) => c.name).join(", ")})`);
	}

	const startMs = Date.now();
	// Generate trace ID for observability correlation (PRD-20)
	const xrayTraceId = process.env._X_AMZN_TRACE_ID;
	const traceId = xrayTraceId?.match(/Root=([^;]+)/)?.[1] || randomBytes(16).toString("hex");

	// Insert synthetic user message for non-chat sources so all thread types
	// have a consistent user → assistant message flow in the timeline.
	// For chat_message source, sendMessage.mutation.ts already inserted the user message.
	if (runThreadId && wakeup.source !== "chat_message") {
		const userContent = agentMessage.trim();
		await insertUserMessage(runThreadId, wakeup.tenant_id, userContent);
	}

	try {
		const triggerChannel = threadContext?.channel || wakeup.source || "";

		console.log(`[wakeup-processor] Invoking AgentCore for agent=${wakeup.agent_id} runtime=${runtimeType} mcp=${mcpServers.join(",")} source=${wakeup.source} traceId=${traceId}`);

		const invokeResponse = await invokeAgentCore({
			tenant_id: wakeup.tenant_id,
			assistant_id: wakeup.agent_id,
			thread_id: resolvedThreadId,
			user_id: agent.human_pair_id || undefined,
			trace_id: traceId,
			message: agentMessage,
			use_memory: true,
			tenant_slug: tenantSlug || undefined,
			instance_id: agentSlug || undefined,
			agent_name: agent.name,
			human_name: humanName || undefined,
			workspace_bucket: WORKSPACE_BUCKET || undefined,
			workspace_prefix: workspacePrefix,
			hindsight_endpoint: HINDSIGHT_ENDPOINT || undefined,
			runtime_type: runtimeType,
			model: agent.model,
			skills: skillsConfig.length > 0 ? skillsConfig : undefined,
			knowledge_bases: knowledgeBasesConfig,
			guardrail_config: guardrailPayload || undefined,
			mcp_servers: mcpServers,
			mcp_base_url: MCP_BASE_URL || undefined,
			mcp_auth_secret: MCP_AUTH_SECRET || undefined,
			gateway_url: AGENTCORE_GATEWAY_URL || undefined,
			mcp_configs: mcpConfigs.length > 0 ? mcpConfigs : undefined,
			session_key: triggerId || `wakeup-${wakeup.source}`,
			trigger_channel: triggerChannel || undefined,
		});

		const durationMs = Date.now() - startMs;

		if (!invokeResponse.ok) {
			throw new Error(`AgentCore invoke failed: ${invokeResponse.status} ${JSON.stringify(invokeResponse.result)}`);
		}

		const invokeResult = invokeResponse.result;
		const rawResponseText = extractResponseText(invokeResult.response || invokeResult);

		// PRD-22: Use response directly (signal protocol removed)
		const responseText = rawResponseText;

		// Extract tools_called for turn loop detection
		const toolsCalled = (invokeResult.tools_called || (invokeResult.response as Record<string, unknown>)?.tools_called || []) as string[];

		console.log(`[wakeup-processor] AgentCore response (${responseText.length} chars) in ${durationMs}ms`);

		// 6. Handle response based on source type

		if (wakeup.source === "chat_message" || wakeup.source === "automation") {
			// Insert assistant message + notify subscribers (chat flow)
			const threadId = String(payload?.threadId || "");
			if (threadId && responseText && responseText !== "{}") {
				const assistantMsg = await insertAssistantMessage(
					threadId, wakeup.tenant_id, wakeup.agent_id, responseText,
				);
				if (assistantMsg) {
					await notifyNewMessage({
						messageId: assistantMsg.id,
						threadId,
						tenantId: wakeup.tenant_id,
						role: "assistant",
						content: responseText,
						senderType: "agent",
						senderId: wakeup.agent_id,
					});
				}
			}
		} else if (wakeup.source === "email_triage" && responseText && responseText !== "{}") {
			// Post triage summary to a dedicated triage thread
			const runtimeConfig = (agent.runtime_config as Record<string, unknown>) || {};
			const prodConfig = (runtimeConfig.productivityConfig as Record<string, unknown>) || {};
			let triageThreadId = prodConfig.triageChatThreadId as string | undefined;

			// Auto-create triage thread if none exists
			if (!triageThreadId) {
				try {
					const { threadId } = await ensureThreadForWork({
						tenantId: wakeup.tenant_id,
						agentId: wakeup.agent_id,
						title: `${agent.name} — Email Triage`,
						channel: "email",
					});
					triageThreadId = threadId;
					runThreadId = threadId;

					// Persist the thread ID in runtime_config so future triage runs reuse it
					await db
						.update(agents)
						.set({
							runtime_config: {
								...runtimeConfig,
								productivityConfig: { ...prodConfig, triageChatThreadId: triageThreadId },
							},
						})
						.where(eq(agents.id, wakeup.agent_id));

					console.log(`[wakeup-processor] Created triage thread ${triageThreadId} for agent ${wakeup.agent_id}`);
				} catch (threadErr) {
					console.error(`[wakeup-processor] Failed to create triage thread:`, threadErr);
				}
			} else {
				// Existing triage thread — use it directly
				if (!runThreadId) {
					runThreadId = triageThreadId;
				}
			}

			if (triageThreadId) {
				const assistantMsg = await insertAssistantMessage(
					triageThreadId, wakeup.tenant_id, wakeup.agent_id, responseText,
				);
				if (assistantMsg) {
					await notifyNewMessage({
						messageId: assistantMsg.id,
						threadId: triageThreadId,
						tenantId: wakeup.tenant_id,
						role: "assistant",
						content: responseText,
						senderType: "agent",
						senderId: wakeup.agent_id,
					});
				}
			}
		} else if (wakeup.source === "email_received" && responseText && responseText !== "{}") {
			// Route response to email thread (create or reuse based on reply token context)
			const replyTokenContextId = payload?.replyTokenContextId as string | undefined;
			const emailSubject = (payload?.subject as string) || "(no subject)";
			let emailThreadId = replyTokenContextId || "";

			if (replyTokenContextId) {
				// replyTokenContextId now points directly to a thread (data was migrated)
				if (!runThreadId) {
					runThreadId = replyTokenContextId;
				}
			}

			// Auto-create email thread if no context from reply token
			if (!emailThreadId) {
				try {
					const { threadId } = await ensureThreadForWork({
						tenantId: wakeup.tenant_id,
						agentId: wakeup.agent_id,
						title: `Email: ${emailSubject}`,
						channel: "email",
					});
					emailThreadId = threadId;
					runThreadId = threadId;

					console.log(`[wakeup-processor] Created email thread ${emailThreadId} for agent ${wakeup.agent_id}`);
				} catch (threadErr) {
					console.error(`[wakeup-processor] Failed to create email thread:`, threadErr);
				}
			}

			if (emailThreadId) {
				// Insert the inbound email as a user message
				const fromEmail = (payload?.from as string) || "unknown";
				const emailBody = (payload?.body as string) || "";
				const inboundContent = `**From:** ${fromEmail}\n**Subject:** ${emailSubject}\n\n${emailBody}`;
				await insertAssistantMessage(emailThreadId, wakeup.tenant_id, wakeup.agent_id, inboundContent);

				// Insert the agent's response
				const assistantMsg = await insertAssistantMessage(
					emailThreadId, wakeup.tenant_id, wakeup.agent_id, responseText,
				);
				if (assistantMsg) {
					await notifyNewMessage({
						messageId: assistantMsg.id,
						threadId: emailThreadId,
						tenantId: wakeup.tenant_id,
						role: "assistant",
						content: responseText,
						senderType: "agent",
						senderId: wakeup.agent_id,
					});
				}
			}
		} else if (wakeup.source === "webhook" && responseText && responseText !== "{}") {
			// Post webhook response to the thread
			if (runThreadId) {
				const assistantMsg = await insertAssistantMessage(
					runThreadId, wakeup.tenant_id, wakeup.agent_id, responseText,
				);
				if (assistantMsg) {
					await notifyNewMessage({
						messageId: assistantMsg.id,
						threadId: runThreadId,
						tenantId: wakeup.tenant_id,
						role: "assistant",
						content: responseText,
						senderType: "agent",
						senderId: wakeup.agent_id,
					});
				}
			}
		}

		// Catch-all: insert assistant message for sources that don't already do it
		// (chat_message, automation, email_triage, email_received, webhook already insert above)
		const SOURCES_WITH_MESSAGES = ["chat_message", "automation", "email_triage", "email_received", "webhook"];
		if (runThreadId && responseText && responseText !== "{}" && !SOURCES_WITH_MESSAGES.includes(wakeup.source)) {
			const assistantMsg = await insertAssistantMessage(runThreadId, wakeup.tenant_id, wakeup.agent_id, responseText);
			if (assistantMsg) {
				await notifyNewMessage({
					messageId: assistantMsg.id,
					threadId: runThreadId,
					tenantId: wakeup.tenant_id,
					role: "assistant",
					content: responseText,
					senderType: "agent",
					senderId: wakeup.agent_id,
				});
			}
		}

		// Link orphan artifacts created during this turn to the thread + last message
		if (runThreadId && wakeup.agent_id) {
			try {
				const lastMsg = await db.select({ id: messages.id }).from(messages)
					.where(and(eq(messages.thread_id, runThreadId), eq(messages.role, "assistant")))
					.orderBy(desc(messages.created_at)).limit(1);
				if (lastMsg.length > 0) {
					const { isNull, gte } = await import("drizzle-orm");
					const turnStart = new Date(run.started_at || run.created_at);
					await db.update(artifacts).set({
						thread_id: runThreadId,
						source_message_id: lastMsg[0].id,
					}).where(and(
						eq(artifacts.agent_id, wakeup.agent_id),
						eq(artifacts.tenant_id, wakeup.tenant_id),
						isNull(artifacts.source_message_id),
						gte(artifacts.created_at, turnStart),
					));
				}
			} catch (err) {
				console.error("[wakeup-processor] Failed to link orphan artifacts:", err);
			}
		}

		// PRD-15: If thread_id was resolved mid-flight (email branches), update the thread_turn
		if (runThreadId && !run.thread_id) {
			try {
				const [c] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(threadTurns).where(eq(threadTurns.thread_id, runThreadId));
				await db.update(threadTurns).set({ thread_id: runThreadId, turn_number: (c?.count || 0) + 1 }).where(eq(threadTurns.id, run.id));
			} catch {}
		}

		// 7. Record cost events (PRD-02)
		const usage = extractUsage(invokeResult);
		try {
			const costResult = await recordCostEvents({
				tenantId: wakeup.tenant_id,
				agentId: wakeup.agent_id,
				requestId: wakeup.id,
				model: usage.model || agent.model || null,
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				cachedReadTokens: usage.cachedReadTokens,
				durationMs,
				inputText: agentMessage,
				outputText: responseText,
				threadId: runThreadId,
				traceId,
			});
			await checkBudgetAndPause(wakeup.tenant_id, wakeup.agent_id);

			// Notify subscribers that cost was recorded
			if (costResult.totalUsd > 0) {
				await notifyCostRecorded({
					tenantId: wakeup.tenant_id,
					agentId: wakeup.agent_id,
					agentName: agent.name,
					eventType: "invocation",
					amountUsd: costResult.totalUsd,
					model: usage.model || agent.model || null,
				});
			}
		} catch (costErr) {
			console.error(`[wakeup-processor] Cost recording failed:`, costErr);
			// Non-fatal — don't fail the wakeup for cost tracking issues
		}

		// 7b. Record tool costs (Nova Act, browser sessions, etc.)
		const toolCosts = (invokeResult.tool_costs || (invokeResult.response as Record<string, unknown>)?.tool_costs || []) as Array<Record<string, unknown>>;
		if (toolCosts.length > 0) {
			try {
				for (const tc of toolCosts) {
					await db.insert(costEvents).values({
						tenant_id: wakeup.tenant_id,
						agent_id: wakeup.agent_id,
						thread_id: runThreadId || undefined,
						request_id: crypto.randomUUID(),
						event_type: String(tc.event_type || "tool_cost"),
						amount_usd: String(tc.amount_usd || "0.000000"),
						provider: String(tc.provider || "unknown"),
						duration_ms: (tc.duration_ms as number) || null,
						trace_id: traceId || undefined,
						metadata: tc.metadata || {},
					}).onConflictDoNothing();
				}
				console.log(`[wakeup-processor] Recorded ${toolCosts.length} tool cost(s)`);
			} catch (err) {
				console.error(`[wakeup-processor] Tool cost recording failed:`, err);
			}
		}

		// PRD-22: Persistent turn loop — re-invoke when agent called tools (replaces signal-based continue)
		if (
			workflowConfig.turnLoop.enabled &&
			workflowConfig.turnLoop.continueOnToolUse &&
			runThreadId &&
			toolsCalled.length > 0 &&
			workflowConfig.turnLoop.maxTurns > 1
		) {
			let loopTurn = 1;
			let loopMessage = responseText;
			let loopResponseText = responseText;
			let loopToolsCalled = toolsCalled;
			const maxTurns = workflowConfig.turnLoop.maxTurns;

			while (loopToolsCalled.length > 0 && loopTurn < maxTurns) {
				loopTurn++;
				console.log(`[wakeup-processor] Turn loop iteration ${loopTurn}/${maxTurns} for wakeup ${wakeup.id}`);

				// Update last_activity_at to prevent false stall detection
				await db
					.update(threadTurns)
					.set({ last_activity_at: new Date() })
					.where(eq(threadTurns.id, run.id));

				const loopResponse = await invokeAgentCore({
					tenant_id: wakeup.tenant_id,
					assistant_id: wakeup.agent_id,
					thread_id: resolvedThreadId,
					user_id: agent.human_pair_id || undefined,
					message: `Continue working. Previous response:\n${loopMessage.slice(0, 2000)}`,
					use_memory: true,
					tenant_slug: tenantSlug || undefined,
					instance_id: agentSlug || undefined,
					agent_name: agent.name,
					human_name: humanName || undefined,
					workspace_bucket: WORKSPACE_BUCKET || undefined,
					workspace_prefix: workspacePrefix,
					hindsight_endpoint: HINDSIGHT_ENDPOINT || undefined,
					runtime_type: runtimeType,
					model: agent.model,
					skills: skillsConfig.length > 0 ? skillsConfig : undefined,
					knowledge_bases: knowledgeBasesConfig,
					guardrail_config: guardrailPayload || undefined,
					mcp_servers: mcpServers,
					mcp_base_url: MCP_BASE_URL || undefined,
					mcp_auth_secret: MCP_AUTH_SECRET || undefined,
					gateway_url: AGENTCORE_GATEWAY_URL || undefined,
					mcp_configs: mcpConfigs.length > 0 ? mcpConfigs : undefined,
					session_key: triggerId || `wakeup-${wakeup.source}`,
					trigger_channel: threadContext?.channel || wakeup.source || undefined,
				});

				if (!loopResponse.ok) {
					console.error(`[wakeup-processor] Turn loop invoke failed on iteration ${loopTurn}: ${loopResponse.status}`);
					break;
				}

				const loopResult = loopResponse.result;
				const rawLoop = extractResponseText(loopResult.response || loopResult);
				loopMessage = rawLoop;
				loopResponseText = rawLoop;
				loopToolsCalled = (loopResult.tools_called || (loopResult.response as Record<string, unknown>)?.tools_called || []) as string[];

				// Record cost for this loop iteration
				const loopUsage = extractUsage(loopResult);
				try {
					await recordCostEvents({
						tenantId: wakeup.tenant_id,
						agentId: wakeup.agent_id,
						requestId: `${wakeup.id}-loop-${loopTurn}`,
						model: loopUsage.model || agent.model || null,
						inputTokens: loopUsage.inputTokens,
						outputTokens: loopUsage.outputTokens,
						cachedReadTokens: loopUsage.cachedReadTokens,
						durationMs: 0,
						inputText: "",
						outputText: loopResponseText,
						threadId: runThreadId,
				traceId,
					});
				} catch {}

				// Insert loop response as assistant message for chat sources
				if ((wakeup.source === "chat_message" || wakeup.source === "automation") && loopResponseText && loopResponseText !== "{}") {
					const threadId = String(payload?.threadId || "");
					if (threadId) {
						const msg = await insertAssistantMessage(threadId, wakeup.tenant_id, wakeup.agent_id, loopResponseText);
						if (msg) {
							await notifyNewMessage({
								messageId: msg.id,
								threadId,
								tenantId: wakeup.tenant_id,
								role: "assistant",
								content: loopResponseText,
								senderType: "agent",
								senderId: wakeup.agent_id,
							});
						}
					}
				}

				// Log loop event
				await insertRunEvent(run.id, wakeup.tenant_id, wakeup.agent_id, loopTurn + 2, "turn_loop", {
					iteration: loopTurn,
					toolsCalled: loopToolsCalled,
				});
			}

			console.log(`[wakeup-processor] Turn loop completed: ${loopTurn} turns, tools in last turn: ${loopToolsCalled.length}`);
		}

		// 8. Update scheduled_job_run as succeeded
		await db
			.update(threadTurns)
			.set({
				status: "succeeded",
				finished_at: new Date(),
				result_json: { response: responseText.slice(0, 10000) },
				usage_json: {
					duration_ms: durationMs,
					input_tokens: usage.inputTokens,
					output_tokens: usage.outputTokens,
					cached_read_tokens: usage.cachedReadTokens,
					tools_called: (invokeResult.tools_called || (invokeResult.response as Record<string, unknown>)?.tools_called || []) as string[],
					tool_costs: toolCosts.map((tc: Record<string, unknown>) => ({ event_type: tc.event_type, amount_usd: tc.amount_usd, provider: tc.provider })),
				},
			})
			.where(eq(threadTurns.id, run.id));

		// Log completion event
		await insertRunEvent(run.id, wakeup.tenant_id, wakeup.agent_id || null, 2, "completed", {
			duration_ms: durationMs,
			response_length: responseText.length,
		});

		// Notify subscribers that run succeeded
		await notifyThreadTurnUpdate({
			runId: run.id,
			triggerId,
			tenantId: wakeup.tenant_id,
			threadId: runThreadId || null,
			agentId: wakeup.agent_id || null,
			status: "succeeded",
			triggerName,
		});

		// Stamp last_turn_completed_at + preview on thread (drives inbox sorting & list preview)
		if (runThreadId) {
			try {
				await db.update(threads).set({
					last_turn_completed_at: new Date(),
					last_response_preview: responseText.replace(/[#*_`]/g, "").trim().slice(0, 200) || null,
				}).where(eq(threads.id, runThreadId));
			} catch (e) { console.error("[wakeup-processor] Failed to stamp last_turn_completed_at:", e); }
		}

		// Send push notification to user devices
		if (runThreadId) {
			try {
				const { sendTurnCompletedPush } = await import("../lib/push-notifications.js");
				await sendTurnCompletedPush({
					threadId: runThreadId,
					tenantId: wakeup.tenant_id,
					agentId: wakeup.agent_id,
					title: agent.name || "Agent",
					body: responseText.replace(/[#*_`]/g, "").trim(),
				});
			} catch (err) {
				console.error("[wakeup-processor] Push notification failed:", err);
			}
		}

		// 8. Mark wakeup as completed
		await db
			.update(agentWakeupRequests)
			.set({ status: "completed", finished_at: new Date() })
			.where(eq(agentWakeupRequests.id, wakeup.id));

		// Update agent last_heartbeat_at
		await db
			.update(agents)
			.set({ last_heartbeat_at: new Date() })
			.where(eq(agents.id, wakeup.agent_id));

		// PRD-09 Batch 4: Promote next deferred wakeup for this thread
		if (runThreadId) {
			try {
				await promoteNextDeferredWakeup(wakeup.tenant_id, runThreadId);
			} catch {}
		}

	} catch (err) {
		const durationMs = Date.now() - startMs;
		const errMsg = err instanceof Error ? err.message : String(err);
		console.error(`[wakeup-processor] AgentCore invocation failed for wakeup ${wakeup.id}:`, errMsg);

		// Update scheduled_job_run as failed
		await db
			.update(threadTurns)
			.set({
				status: "failed",
				finished_at: new Date(),
				error: errMsg,
				usage_json: { duration_ms: durationMs },
			})
			.where(eq(threadTurns.id, run.id));

		// Log error event
		await insertRunEvent(run.id, wakeup.tenant_id, wakeup.agent_id || null, 2, "error", {
			error: errMsg,
			duration_ms: durationMs,
		});

		// Notify subscribers that run failed
		await notifyThreadTurnUpdate({
			runId: run.id,
			triggerId,
			tenantId: wakeup.tenant_id,
			threadId: runThreadId || null,
			agentId: wakeup.agent_id || null,
			status: "failed",
			triggerName,
		});

		// Stamp last_turn_completed_at on thread (drives inbox sorting)
		if (runThreadId) {
			try {
				await db.update(threads).set({
					last_turn_completed_at: new Date(),
					last_response_preview: `Error: ${errMsg}`.slice(0, 200),
				}).where(eq(threads.id, runThreadId));
			} catch (e) { console.error("[wakeup-processor] Failed to stamp last_turn_completed_at:", e); }
		}

		// If this was a chat message, insert error reply so user gets feedback
		if (wakeup.source === "chat_message" || wakeup.source === "automation") {
			const threadId = String((payload as Record<string, unknown>)?.threadId || "");
			if (threadId) {
				try {
					const errReply = await insertAssistantMessage(
						threadId, wakeup.tenant_id, wakeup.agent_id,
						"I'm sorry, I encountered an error processing your request. Please try again.",
					);
					if (errReply) {
						await notifyNewMessage({
							messageId: errReply.id,
							threadId,
							tenantId: wakeup.tenant_id,
							role: "assistant",
							content: "I'm sorry, I encountered an error processing your request. Please try again.",
							senderType: "agent",
							senderId: wakeup.agent_id,
						});
					}
				} catch (innerErr) {
					console.error(`[wakeup-processor] Failed to insert error message:`, innerErr);
				}
			}
		}

		await failWakeup(wakeup.id, errMsg);

		// PRD-09 Batch 4: Promote next deferred wakeup even on failure
		if (runThreadId) {
			try {
				await promoteNextDeferredWakeup(wakeup.tenant_id, runThreadId);
			} catch {}
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function failWakeup(wakeupId: string, error: string): Promise<void> {
	await db
		.update(agentWakeupRequests)
		.set({ status: "failed", finished_at: new Date() })
		.where(eq(agentWakeupRequests.id, wakeupId));
}

async function insertRunEvent(
	runId: string,
	tenantId: string,
	agentId: string | null,
	seq: number,
	eventType: string,
	payload: Record<string, unknown>,
): Promise<void> {
	try {
		await db.insert(threadTurnEvents).values({
			run_id: runId,
			tenant_id: tenantId,
			agent_id: agentId,
			seq,
			event_type: eventType,
			stream: "system",
			level: eventType === "error" ? "error" : "info",
			message: eventType,
			payload,
		});
	} catch (err) {
		console.error(`[wakeup-processor] Failed to insert run event:`, err);
	}
}

function extractResponseText(data: unknown): string {
	if (typeof data === "string") return data;
	if (!data || typeof data !== "object") return String(data);

	const obj = data as Record<string, unknown>;

	// OpenAI ChatCompletion format
	if (Array.isArray(obj.choices) && (obj.choices[0] as Record<string, unknown>)?.message) {
		return String((((obj.choices as Record<string, unknown>[])[0]).message as Record<string, unknown>)?.content || "");
	}

	if (typeof obj.content === "string") return obj.content;
	if (typeof obj.response === "string") return obj.response;
	if (typeof obj.output === "string") return obj.output;
	if (typeof obj.text === "string") return obj.text;

	if (obj.response && typeof obj.response === "object") {
		return extractResponseText(obj.response);
	}

	return JSON.stringify(data);
}

async function insertAssistantMessage(
	threadId: string,
	tenantId: string,
	agentId: string,
	content: string,
): Promise<{ id: string } | null> {
	try {
		const [row] = await db
			.insert(messages)
			.values({
				thread_id: threadId,
				tenant_id: tenantId,
				role: "assistant",
				content,
				sender_type: "agent",
				sender_id: agentId,
			})
			.returning({ id: messages.id });
		console.log(`[wakeup-processor] Inserted assistant message: ${row.id}`);
		return row;
	} catch (err) {
		console.error(`[wakeup-processor] Failed to insert assistant message:`, err);
		return null;
	}
}

async function insertUserMessage(threadId: string, tenantId: string, content: string): Promise<{ id: string } | null> {
	try {
		const [row] = await db
			.insert(messages)
			.values({
				thread_id: threadId,
				tenant_id: tenantId,
				role: "user",
				content,
				sender_type: "system",
			})
			.returning({ id: messages.id });
		console.log(`[wakeup-processor] Inserted user message: ${row.id}`);
		return row;
	} catch (err) {
		console.error(`[wakeup-processor] Failed to insert user message:`, err);
		return null;
	}
}

async function notifyThreadTurnUpdate(payload: {
	runId: string;
	triggerId: string | null;
	tenantId: string;
	threadId: string | null;
	agentId: string | null;
	status: string;
	triggerName: string | null;
}): Promise<void> {
	if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) return;

	const mutation = `
		mutation NotifyThreadTurnUpdate(
			$runId: ID!
			$triggerId: ID
			$tenantId: ID!
			$threadId: ID
			$agentId: ID
			$status: String!
			$triggerName: String
		) {
			notifyThreadTurnUpdate(
				runId: $runId
				triggerId: $triggerId
				tenantId: $tenantId
				threadId: $threadId
				agentId: $agentId
				status: $status
				triggerName: $triggerName
			) {
				runId
				triggerId
				tenantId
				threadId
				agentId
				status
				triggerName
				updatedAt
			}
		}
	`;

	try {
		const response = await fetch(APPSYNC_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": APPSYNC_API_KEY,
			},
			body: JSON.stringify({ query: mutation, variables: payload }),
		});
		const responseBody = await response.text();
		if (!response.ok || responseBody.includes('"errors"')) {
			console.error(`[wakeup-processor] AppSync notifyThreadTurnUpdate issue: ${response.status} ${responseBody}`);
		}
	} catch (err) {
		console.error(`[wakeup-processor] AppSync notifyThreadTurnUpdate error:`, err);
	}
}

async function notifyNewMessage(payload: {
	messageId: string;
	threadId: string;
	tenantId: string;
	role: string;
	content: string;
	senderType: string;
	senderId: string;
}): Promise<void> {
	if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) {
		console.warn(`[wakeup-processor] AppSync not configured, skipping notification`);
		return;
	}

	const mutation = `
		mutation NotifyNewMessage(
			$messageId: ID!
			$threadId: ID!
			$tenantId: ID!
			$role: String!
			$content: String!
			$senderType: String
			$senderId: ID
		) {
			notifyNewMessage(
				messageId: $messageId
				threadId: $threadId
				tenantId: $tenantId
				role: $role
				content: $content
				senderType: $senderType
				senderId: $senderId
			) {
				messageId
				threadId
				tenantId
				role
				content
				senderType
				senderId
				createdAt
			}
		}
	`;

	try {
		const response = await fetch(APPSYNC_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": APPSYNC_API_KEY,
			},
			body: JSON.stringify({ query: mutation, variables: payload }),
		});
		const responseBody = await response.text();
		if (!response.ok || responseBody.includes('"errors"')) {
			console.error(`[wakeup-processor] AppSync notify issue: ${response.status} ${responseBody}`);
		}
	} catch (err) {
		console.error(`[wakeup-processor] AppSync notify error:`, err);
	}
}


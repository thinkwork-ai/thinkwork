import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
	activityLog,
	mutationIdempotency,
	tenantContextProviderSettings,
	tenantEntityPages,
	users,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import { writeFacetSection } from "./repository.js";
import type { FactCitation, FacetType } from "./facet-types.js";

export interface BrainWriteRequest {
	tenantId: string;
	invokerUserId: string;
	entityRef: {
		pageTable: "tenant_entity_pages";
		pageId: string;
		subtype: string;
	};
	factPayload: {
		facetType: FacetType;
		content: string;
		sources: FactCitation[];
		sectionSlug?: string;
		heading?: string;
	};
	idempotencyKey: string;
}

export async function assertInvokerBelongsToTenant(args: {
	tenantId: string;
	invokerUserId: string;
}): Promise<boolean> {
	const [row] = await defaultDb
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				eq(users.id, args.invokerUserId),
				eq(users.tenant_id, args.tenantId),
			),
		)
		.limit(1);
	return Boolean(row);
}

export async function brainWritesEnabledForTenant(tenantId: string): Promise<boolean> {
	const [setting] = await defaultDb
		.select({ enabled: tenantContextProviderSettings.enabled })
		.from(tenantContextProviderSettings)
		.where(
			and(
				eq(tenantContextProviderSettings.tenant_id, tenantId),
				eq(tenantContextProviderSettings.provider_id, "brain-agent-write"),
			),
		)
		.limit(1);
	return setting?.enabled === true;
}

export async function writeBrainFact(
	request: BrainWriteRequest,
): Promise<{ sectionId: string }> {
	if (request.entityRef.pageTable !== "tenant_entity_pages") {
		throw new Error("brain-write v0 only supports tenant_entity_pages");
	}
	if (!request.idempotencyKey.trim()) {
		throw new Error("idempotencyKey is required");
	}
	if (!request.factPayload.content.trim()) {
		throw new Error("fact content is required");
	}

	return await defaultDb.transaction(async (tx) => {
		const mutationName = "brain-agent-write";
		const [prior] = await tx
			.select({
				status: mutationIdempotency.status,
				resultJson: mutationIdempotency.result_json,
			})
			.from(mutationIdempotency)
			.where(
				and(
					eq(mutationIdempotency.tenant_id, request.tenantId),
					eq(mutationIdempotency.invoker_user_id, request.invokerUserId),
					eq(mutationIdempotency.mutation_name, mutationName),
					eq(mutationIdempotency.idempotency_key, request.idempotencyKey),
				),
			)
			.limit(1);
		if (prior?.status === "succeeded" && isSectionResult(prior.resultJson)) {
			return prior.resultJson;
		}
		if (prior) {
			throw new Error("brain-write idempotency key is already in flight");
		}
		await tx.insert(mutationIdempotency).values({
			tenant_id: request.tenantId,
			invoker_user_id: request.invokerUserId,
			mutation_name: mutationName,
			idempotency_key: request.idempotencyKey,
			resolved_inputs_hash: hashResolvedInputs(request),
			status: "pending",
		});

		const [page] = await tx
			.select({
				id: tenantEntityPages.id,
				tenantId: tenantEntityPages.tenant_id,
			})
			.from(tenantEntityPages)
			.where(eq(tenantEntityPages.id, request.entityRef.pageId))
			.limit(1);
		if (!page || page.tenantId !== request.tenantId) {
			throw new BrainWriteNotFoundError();
		}

		const result = await writeFacetSection(
			{
				tenantId: request.tenantId,
				pageId: request.entityRef.pageId,
				facetType: request.factPayload.facetType,
				sectionSlug:
					request.factPayload.sectionSlug ??
					`${request.factPayload.facetType}-${request.idempotencyKey.slice(0, 12)}`,
				heading: request.factPayload.heading ?? "Agent-written fact",
				content: sanitizeBrainContent(request.factPayload.content),
				sources: request.factPayload.sources,
			},
			tx,
		);
		await tx.insert(activityLog).values({
			tenant_id: request.tenantId,
			actor_type: "assistant",
			actor_id: request.invokerUserId,
			action: "brain_write_accepted",
			entity_type: "tenant_entity_page",
			entity_id: request.entityRef.pageId,
			metadata: {
				idempotencyKey: request.idempotencyKey,
				sectionId: result.sectionId,
				facetType: request.factPayload.facetType,
			},
		});
		const response = { sectionId: result.sectionId };
		await tx
			.update(mutationIdempotency)
			.set({
				status: "succeeded",
				result_json: response,
				completed_at: new Date(),
			})
			.where(
				and(
					eq(mutationIdempotency.tenant_id, request.tenantId),
					eq(mutationIdempotency.invoker_user_id, request.invokerUserId),
					eq(mutationIdempotency.mutation_name, mutationName),
					eq(mutationIdempotency.idempotency_key, request.idempotencyKey),
				),
			);
		return response;
	});
}

export class BrainWriteNotFoundError extends Error {
	override readonly name = "BrainWriteNotFoundError";
	constructor() {
		super("tenant entity page not found");
	}
}

function sanitizeBrainContent(content: string): string {
	return content
		.replaceAll("<|im_start|>", "")
		.replaceAll("<|im_end|>", "")
		.replace(/[\u200B-\u200D\uFEFF]/g, "")
		.trim();
}

function hashResolvedInputs(request: BrainWriteRequest): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				tenantId: request.tenantId,
				invokerUserId: request.invokerUserId,
				entityRef: request.entityRef,
				factPayload: request.factPayload,
			}),
		)
		.digest("hex");
}

function isSectionResult(value: unknown): value is { sectionId: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { sectionId?: unknown }).sectionId === "string"
	);
}

/**
 * Orchestration for the one-off link backfill (plan Unit 4). Pure-ish
 * coordinator — every side effect is routed through an injected callback
 * so tests can drive it without a database.
 *
 * Phase A: reads all active pages in scope, derives parent candidates
 * from their summaries (reusing the aggregation pass's page-summary
 * expander), and fans `emitDeterministicParentLinks` across every active
 * entity page. Each entity page carries its own id as a "source record"
 * so the linker's overlap gate still applies.
 *
 * Phase B: collects every `memory_unit` id referenced by
 * `wiki_section_sources` in scope and calls `emitCoMentionLinks`
 * directly — same emitter the live compile uses, so the guardrails
 * match.
 */

import {
	deriveParentCandidatesFromPageSummaries,
	type PageSummaryCandidateInput,
} from "./parent-expander.js";
import {
	emitCoMentionLinks,
	emitDeterministicParentLinks,
	type AffectedPage,
	type LookupMemorySources,
	type ParentPageFuzzyLookup,
	type ParentPageLookup,
	type WriteLinkArgs,
} from "./deterministic-linker.js";
import type { WikiPageType } from "./repository.js";

export interface BackfillPage {
	id: string;
	type: WikiPageType;
	slug: string;
	title: string;
	summary: string | null;
}

export interface RunLinkBackfillArgs {
	scope: { tenantId: string; ownerId: string };
	dryRun: boolean;
	listAllActivePages: () => Promise<BackfillPage[]>;
	listMemoryUnitIds: () => Promise<string[]>;
	lookupParentPages: ParentPageLookup;
	/** Optional trigram fallback for the parent lookup. Callers running the
	 * live compile wire this to `findPagesByFuzzyTitle`; tests can omit. */
	lookupParentPagesFuzzy?: ParentPageFuzzyLookup;
	lookupMemorySources: LookupMemorySources;
	upsertPageLink: (args: WriteLinkArgs) => Promise<void>;
	log?: (line: string) => void;
}

export interface RunLinkBackfillResult {
	pagesSeen: number;
	candidates: number;
	parentLinksWritten: number;
	memoryUnitsSeen: number;
	coMentionLinksWritten: number;
}

export async function runLinkBackfill(
	args: RunLinkBackfillArgs,
): Promise<RunLinkBackfillResult> {
	const log = args.log ?? (() => {});

	const writeLink = args.dryRun
		? async (link: WriteLinkArgs): Promise<void> => {
				log(
					`[dry-run] ${link.fromPageId} → ${link.toPageId}  ctx=${link.context}`,
				);
			}
		: args.upsertPageLink;

	// ─── Phase A: deterministic parent links from page summaries ──────
	const allPages = await args.listAllActivePages();
	log(`[phase-a] ${allPages.length} active pages in scope`);

	const summaryInputs: PageSummaryCandidateInput[] = allPages.map((p) => ({
		id: p.id,
		summary: p.summary,
		title: p.title,
	}));
	const candidates = deriveParentCandidatesFromPageSummaries(summaryInputs);
	log(`[phase-a] ${candidates.length} parent candidates derived from summaries`);

	// Backfill treats every active entity page as affected and identifies
	// it via its own id — the page-summary expander populates
	// `sourceRecordIds` with page ids, so the linker's overlap check lights
	// up on self-id for pages that actually contributed to the candidate.
	const affectedPages: AffectedPage[] = allPages
		.filter((p) => p.type === "entity")
		.map((p) => ({
			id: p.id,
			type: p.type,
			slug: p.slug,
			title: p.title,
			sourceRecordIds: [p.id],
		}));
	const parentEmission = await emitDeterministicParentLinks({
		scope: args.scope,
		candidates,
		affectedPages,
		lookupParentPages: args.lookupParentPages,
		lookupParentPagesFuzzy: args.lookupParentPagesFuzzy,
		writeLink,
	});
	log(
		`[phase-a] parent-emitter wrote ${parentEmission.linksWritten} links`,
	);

	// ─── Phase B: co-mention links from wiki_section_sources ───────────
	const memoryUnitIds = await args.listMemoryUnitIds();
	log(`[phase-b] ${memoryUnitIds.length} distinct memory_units in scope`);
	const coMentionEmission = await emitCoMentionLinks({
		scope: args.scope,
		memoryUnitIds,
		lookupMemorySources: args.lookupMemorySources,
		writeLink,
	});
	log(
		`[phase-b] co-mention-emitter wrote ${coMentionEmission.linksWritten} links`,
	);

	if (args.dryRun) {
		log(
			`[summary] dry-run complete — no rows written. ` +
				`Would emit ${parentEmission.linksWritten} parent links + ` +
				`${coMentionEmission.linksWritten} co-mention links.`,
		);
	}

	return {
		pagesSeen: allPages.length,
		candidates: candidates.length,
		parentLinksWritten: parentEmission.linksWritten,
		memoryUnitsSeen: memoryUnitIds.length,
		coMentionLinksWritten: coMentionEmission.linksWritten,
	};
}

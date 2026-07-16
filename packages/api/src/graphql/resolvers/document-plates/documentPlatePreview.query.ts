import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  buildContractPreviewExemplar,
  resolveCandidatePlate,
  resolvePlate,
  drizzlePlateStore,
  type ResolvedPlate,
} from "../../../lib/artifacts/plate-registry.js";
import { getPlatformPlate } from "../../../lib/artifacts/plate-definitions.js";
import { compileDocument } from "../../../lib/artifacts/document-compositor.js";
import {
  boundedSectionOverrides,
  enforcePreviewRateLimit,
  notFound,
  parseDraftConfig,
  requirePlateReader,
  validateCandidatePlate,
  type PlateDraftConfig,
} from "./shared.js";

/**
 * Pure compile query (KTD5): run the plate's per-plate exemplar through the
 * real compositor and return the HTML inline — no artifact persisted,
 * presigned URLs prohibited. With draftConfig (operator editor state) the
 * candidate merges exactly as a save would, and validation diagnostics come
 * back instead of HTML so the editor reports errors before save.
 */
export async function documentPlatePreview(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    slug: string;
    draftConfig?: unknown;
  },
  ctx: GraphQLContext,
): Promise<{
  html: string | null;
  diagnostics: Array<{ code: string; message: string }>;
}> {
  const { tenantId, isOperator } = await requirePlateReader(ctx, args.tenantId);
  enforcePreviewRateLimit(tenantId, ctx.auth.principalId ?? "anon");

  const hasDraft = args.draftConfig !== undefined && args.draftConfig !== null;
  if (hasDraft && !isOperator) {
    throw new GraphQLError("Draft previews are operator-only", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const store = drizzlePlateStore();
  const base = await resolvePlate(tenantId, args.slug, store);
  // List-vs-detail parity: a member who guesses a hidden slug gets not-found.
  if (base?.hidden && !isOperator) {
    throw notFound(`Unknown plate "${args.slug}"`);
  }

  let candidate: ResolvedPlate;
  let draft: PlateDraftConfig = {};
  if (hasDraft) {
    draft = parseDraftConfig(args.draftConfig);
    const origin =
      base && base.origin === "platform" ? "platform_override" : "tenant";
    // THINK-188: platform drafts may patch floor sections; validate the
    // overrides against the plate's actual floor (same bound the save uses).
    const rawDraft = args.draftConfig as Record<string, unknown>;
    // Full-ownership drafts (ownContract) carry the whole contract — floor
    // overrides don't apply.
    const ownContract =
      origin === "platform_override" && rawDraft.ownContract === true;
    const sectionOverrides =
      origin === "platform_override" && !ownContract
        ? boundedSectionOverrides(
            rawDraft.sectionOverrides,
            getPlatformPlate(args.slug)?.sections ?? [],
          )
        : undefined;
    const merged = await resolveCandidatePlate(
      tenantId,
      args.slug,
      {
        origin,
        config: {
          // Editor drafts merge over the existing row the same way a save
          // would replace it: the draft IS the would-be row config.
          displayName: draft.displayName,
          useFor: draft.useFor,
          eyebrow: draft.eyebrow,
          titleSuffix: draft.titleSuffix,
          paletteLight: draft.paletteLight,
          paletteDark: draft.paletteDark,
          allowedDirectives: draft.allowedDirectives,
          sections: draft.sections,
          analyses: draft.analyses,
          ...(sectionOverrides ? { sectionOverrides } : {}),
          ...(ownContract ? { ownContract: true } : {}),
        },
        hidden: base?.hidden ?? false,
      },
      store,
    );
    if (!merged) throw notFound(`Unknown plate "${args.slug}"`);
    candidate = merged;
  } else {
    if (!base) throw notFound(`Unknown plate "${args.slug}"`);
    candidate = base;
  }

  const result = validateCandidatePlate(candidate, {
    light: draft.paletteLight,
    dark: draft.paletteDark,
  });
  if (!result.ok) {
    return { html: null, diagnostics: result.diagnostics };
  }
  // THINK-188 KTD4/R9: the DISPLAYED preview is the richer "contract in
  // action" document (sample-data analyses + waiver demo); the gates above
  // validated the lean save exemplar unchanged. Falls back to the gate HTML
  // if the preview compile ever fails (defensive — both share the compiler).
  const preview = buildContractPreviewExemplar(candidate);
  const compiled = compileDocument({
    plate: candidate,
    title: preview.title,
    abstract: preview.abstract,
    markdownBody: preview.markdownBody,
  });
  return {
    html: compiled.ok ? compiled.renderHtml : result.html,
    diagnostics: [],
  };
}

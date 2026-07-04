/**
 * Living Artifacts agent parity — the `artifacts` extension (THINK-145 U9,
 * R16–R19 / KTD8).
 *
 * Gives the single shared agent parity with the web canvas surface: save the
 * current thread's canvas, load a saved canvas by name into the thread, refresh
 * a canvas's bound data headlessly, and list the space's saved canvases. Each
 * tool is a THIN wrapper over the same GraphQL mutation the web calls — the
 * extension reaches the platform only through the host-supplied
 * {@link CanvasProvider}, so it is identical on the cloud and desktop hosts and
 * there is no second write path.
 *
 * Identity discipline (KTD8): the provider closes over the acting user's id +
 * thread id (host-supplied, turn-bound). The platform mutations assert R15
 * space-membership against THAT user — never against the service principal
 * alone — so a prompt-injected turn cannot save/load/refresh as another user or
 * flip spaces by parameter.
 *
 * Name resolution (R17): exact title match first, then a substring/fuzzy pass,
 * both within the thread's space. A unique match loads/refreshes; ambiguity
 * returns a structured needs-disambiguation result naming the candidates so the
 * model asks the user (never guesses); a zero-match returns a structured
 * not-found result with near-matches (never silently fails).
 *
 * Every `execute` returns a result rather than throwing — a provider failure
 * surfaces as an explicit error result the model can narrate, never a broken
 * turn.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  CanvasProvider,
  CanvasSummaryItem,
  CanvasThreadContext,
} from "@thinkwork/pi-runtime-core";
import { Type } from "typebox";

import {
  defineExtension,
  requireProvider,
  type ThinkworkExtension,
} from "./define-extension.js";

export const SAVE_CANVAS_TOOL_NAME = "save_canvas";
export const LOAD_CANVAS_TOOL_NAME = "load_canvas";
export const REFRESH_CANVAS_DATA_TOOL_NAME = "refresh_canvas_data";
export const LIST_CANVASES_TOOL_NAME = "list_canvases";

/** The four tool names this extension registers, in declaration order. */
export const ARTIFACTS_TOOL_NAMES = [
  SAVE_CANVAS_TOOL_NAME,
  LOAD_CANVAS_TOOL_NAME,
  REFRESH_CANVAS_DATA_TOOL_NAME,
  LIST_CANVASES_TOOL_NAME,
] as const;

/** Max near-matches surfaced on a zero-match resolution. */
const MAX_NEAR_MATCHES = 5;

export interface ArtifactsExtensionOptions {
  /** Explicit kill switch; default true. */
  enabled?: boolean;
  /**
   * Optional sink for non-fatal extension errors (a failed provider call that
   * degraded to an error result). Makes the failure observable instead of
   * silent; the cloud host wires it to structured logging.
   */
  onError?: (error: unknown, context: { phase: string }) => void;
}

// ---------------------------------------------------------------------------
// Name resolution (exported for unit tests — AE5 shapes).
// ---------------------------------------------------------------------------

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokens(value: string): string[] {
  return normalizeName(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Token-overlap score of `query` against a candidate title (0..1). */
function overlapScore(candidateTitle: string, query: string): number {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 0;
  const candidateTokens = new Set(tokens(candidateTitle));
  let shared = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) shared += 1;
  }
  return shared / queryTokens.length;
}

export type CanvasNameResolution =
  | { kind: "match"; item: CanvasSummaryItem }
  | { kind: "ambiguous"; candidates: CanvasSummaryItem[] }
  | { kind: "none"; nearMatches: CanvasSummaryItem[] };

/**
 * Resolve a saved-canvas name within a single space's saved set:
 *   1. exact (case-insensitive) title match — unique ⇒ match, many ⇒ ambiguous.
 *   2. substring match (title contains query, or query contains title) —
 *      unique ⇒ match, many ⇒ ambiguous.
 *   3. no match ⇒ none, with the best token-overlap near-matches.
 *
 * The set is assumed already scoped to the thread's space and to SAVED
 * (non-draft) canvases (R19) — this helper never sees drafts.
 */
export function resolveCanvasByName(
  savedCanvases: readonly CanvasSummaryItem[],
  rawQuery: string,
): CanvasNameResolution {
  const query = normalizeName(rawQuery);
  if (!query) return { kind: "none", nearMatches: [] };

  const exact = savedCanvases.filter(
    (item) => normalizeName(item.title) === query,
  );
  if (exact.length === 1) return { kind: "match", item: exact[0]! };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  const substring = savedCanvases.filter((item) => {
    const title = normalizeName(item.title);
    return title.includes(query) || query.includes(title);
  });
  if (substring.length === 1) return { kind: "match", item: substring[0]! };
  if (substring.length > 1) return { kind: "ambiguous", candidates: substring };

  const nearMatches = savedCanvases
    .map((item) => ({ item, score: overlapScore(item.title, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NEAR_MATCHES)
    .map((entry) => entry.item);
  return { kind: "none", nearMatches };
}

// ---------------------------------------------------------------------------
// Formatting helpers.
// ---------------------------------------------------------------------------

function displayTitle(item: CanvasSummaryItem): string {
  return item.title.trim() || "(untitled canvas)";
}

function formatCanvasLine(item: CanvasSummaryItem): string {
  const version = item.headVersion > 0 ? ` v${item.headVersion}` : "";
  const updated = item.updatedAt ? ` — updated ${item.updatedAt}` : "";
  return `- ${displayTitle(item)} (id ${item.artifactId}${version})${updated}`;
}

function candidateNames(items: readonly CanvasSummaryItem[]): string {
  return items.map((item) => `"${displayTitle(item)}"`).join(", ");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorResult(phase: string, text: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${text}` }],
    details: { ok: false, phase },
  };
}

/**
 * Resolve the target space id for a save: an explicit `spaceName` matched
 * against the acting user's writable spaces, else the thread's home space.
 * Returns a typed error string when a named space cannot be resolved or the
 * thread has no home space to default to.
 */
export function resolveSaveSpaceId(
  context: CanvasThreadContext,
  spaceName: string | undefined,
): { spaceId: string } | { error: string } {
  const named = asString(spaceName ?? "");
  if (named) {
    const normalized = normalizeName(named);
    const matches = context.writableSpaces.filter(
      (space) => normalizeName(space.name) === normalized,
    );
    if (matches.length === 1) return { spaceId: matches[0]!.spaceId };
    if (matches.length > 1) {
      return {
        error:
          `Multiple spaces are named "${named}". Ask the user which space ` +
          "to save into, then call save_canvas again with an unambiguous name.",
      };
    }
    const available =
      context.writableSpaces.length > 0
        ? context.writableSpaces.map((space) => `"${space.name}"`).join(", ")
        : "(none you can save into)";
    return {
      error:
        `No space named "${named}" is available to save into. ` +
        `Spaces you can save into: ${available}.`,
    };
  }
  if (context.spaceId) return { spaceId: context.spaceId };
  return {
    error:
      "This thread has no home space to save the canvas into. Ask the user " +
      "which space to save it to and call save_canvas again with spaceName.",
  };
}

// ---------------------------------------------------------------------------
// Extension.
// ---------------------------------------------------------------------------

export function createArtifactsExtension(
  options: ArtifactsExtensionOptions = {},
): ThinkworkExtension {
  const enabled = options.enabled ?? true;
  const onError = options.onError;

  return defineExtension({
    name: "thinkwork-artifacts",
    // Must be folded into the createAgentSession allowlist or these tools
    // register but never reach the model (the SDK gates to the allowlist).
    toolNames: enabled ? [...ARTIFACTS_TOOL_NAMES] : [],
    register(pi, providers) {
      if (!enabled) return;
      const canvas = requireProvider(
        providers,
        "canvas",
        "thinkwork-artifacts",
      );

      pi.registerTool(buildSaveCanvasTool(canvas, onError));
      pi.registerTool(buildLoadCanvasTool(canvas, onError));
      pi.registerTool(buildRefreshCanvasDataTool(canvas, onError));
      pi.registerTool(buildListCanvasesTool(canvas, onError));
    },
  });
}

type ErrorSink = ArtifactsExtensionOptions["onError"];

function buildSaveCanvasTool(
  canvas: CanvasProvider,
  onError: ErrorSink,
): ToolDefinition {
  return {
    name: SAVE_CANVAS_TOOL_NAME,
    label: "Save Canvas",
    description:
      "Save the current thread's live canvas so it persists in a Space and " +
      'can be reopened later. Use when the user says things like "save this ' +
      'dashboard", "keep this canvas", or "save it to <space>". Saving names ' +
      "the canvas and assigns it to a Space (defaults to this thread's Space); " +
      "it is a cheap, reversible status change, so save when asked without a " +
      "confirmation step. Pass the title the user wants; pass spaceName only " +
      "when they name a different Space. Re-saving an already-saved canvas " +
      "records a new version — it never creates a duplicate.",
    parameters: Type.Object({
      title: Type.String({
        description:
          "The name to save the canvas under (what the user will search by).",
      }),
      canvasPartId: Type.Optional(
        Type.String({
          description:
            "Optional stable part id of the canvas to save. Omit to save the " +
            "current thread's most recent canvas (the common case).",
        }),
      ),
      spaceName: Type.Optional(
        Type.String({
          description:
            "Optional Space name to save into. Omit to use this thread's Space.",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const typed = (params ?? {}) as Record<string, unknown>;
      const title = asString(typed.title);
      const canvasPartId = asString(typed.canvasPartId ?? "");
      const spaceName = asString(typed.spaceName ?? "");
      if (!title)
        return errorResult("save_canvas", "save_canvas requires a title.");

      let context: CanvasThreadContext;
      try {
        context = await canvas.context(signal);
      } catch (error) {
        onError?.(error, { phase: "save_canvas.context" });
        return errorResult(
          "save_canvas",
          "Could not load this thread's canvas context. Try again shortly.",
        );
      }

      // Resolve the target canvas: an explicit part id (matched against the
      // current thread's canvas) or the thread's current canvas.
      const target = context.currentCanvas;
      if (!target) {
        return errorResult(
          "save_canvas",
          "There is no canvas in this thread to save yet. Emit a canvas first, " +
            "then save it.",
        );
      }
      if (
        canvasPartId &&
        target.artifactId !== canvasPartId &&
        target.stablePartId !== canvasPartId
      ) {
        // v1 saves the thread's current canvas; a mismatched explicit id is a
        // model error worth surfacing rather than silently saving the wrong
        // one. Accept either the artifact id or the stable part id — the
        // load/refresh tool results surface both.
        return errorResult(
          "save_canvas",
          `No canvas with part id "${canvasPartId}" is active in this thread. ` +
            "Omit canvasPartId to save the current canvas.",
        );
      }

      const spaceResolution = resolveSaveSpaceId(
        context,
        spaceName || undefined,
      );
      if ("error" in spaceResolution) {
        return errorResult("save_canvas", spaceResolution.error);
      }

      try {
        const result = await canvas.save(
          {
            artifactId: target.artifactId,
            title,
            spaceId: spaceResolution.spaceId,
          },
          signal,
        );
        const version =
          result.headVersion > 0 ? ` (version ${result.headVersion})` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Saved canvas "${result.title || title}"${version}.`,
            },
          ],
          details: { ok: true, ...result },
        };
      } catch (error) {
        onError?.(error, { phase: "save_canvas.save" });
        return errorResult(
          "save_canvas",
          `Could not save the canvas: ${errorMessage(error)}`,
        );
      }
    },
  };
}

function buildLoadCanvasTool(
  canvas: CanvasProvider,
  onError: ErrorSink,
): ToolDefinition {
  return {
    name: LOAD_CANVAS_TOOL_NAME,
    label: "Load Canvas",
    description:
      "Open a previously saved canvas by name into the current thread so the " +
      'user can view and edit it via chat. Use when the user says "open my ' +
      'cost dashboard", "pull up the <name> canvas", or "load <name>". The ' +
      "name is matched against saved canvases in this thread's Space. If the " +
      "name matches more than one canvas, this tool returns the candidates — " +
      "ask the user which one, do NOT guess. If nothing matches, it returns " +
      "the closest names — tell the user no canvas matched and offer those.",
    parameters: Type.Object({
      name: Type.String({
        description: "The saved canvas name (or part of it) to open.",
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const name = asString((params as Record<string, unknown>)?.name);
      if (!name)
        return errorResult("load_canvas", "load_canvas requires a name.");

      let context: CanvasThreadContext;
      try {
        context = await canvas.context(signal);
      } catch (error) {
        onError?.(error, { phase: "load_canvas.context" });
        return errorResult(
          "load_canvas",
          "Could not list saved canvases for this thread. Try again shortly.",
        );
      }

      const resolution = resolveCanvasByName(context.savedCanvases, name);
      if (resolution.kind === "ambiguous") {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `More than one saved canvas matches "${name}": ` +
                `${candidateNames(resolution.candidates)}. Ask the user which ` +
                "one to open, then call load_canvas again with the exact name.",
            },
          ],
          details: {
            ok: false,
            needsDisambiguation: true,
            query: name,
            candidates: resolution.candidates,
          },
        };
      }
      if (resolution.kind === "none") {
        const near =
          resolution.nearMatches.length > 0
            ? ` Closest saved canvases: ${candidateNames(resolution.nearMatches)}.`
            : " There are no saved canvases in this Space yet.";
        return {
          content: [
            {
              type: "text" as const,
              text: `No saved canvas matches "${name}".${near}`,
            },
          ],
          details: {
            ok: false,
            notFound: true,
            query: name,
            nearMatches: resolution.nearMatches,
          },
        };
      }

      try {
        const result = await canvas.checkout(
          resolution.item.artifactId,
          signal,
        );
        // Editing contract: updates MUST re-emit under the canvas's ORIGINAL
        // stable part id — a new id mints a stray draft the save/refresh flow
        // then mistargets. Stating the exact id here is what makes the model
        // comply; enforcement lives in the emit-binding gate.
        const partId = resolution.item.stablePartId;
        const editInstruction = partId
          ? ` To edit it, re-emit the json-render part with the SAME id ` +
            `"${partId}" — do NOT use a new part id, or your edit will create ` +
            `a stray duplicate instead of updating this canvas.`
          : "";
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Opened canvas "${result.title || displayTitle(resolution.item)}" in this thread.` +
                editInstruction,
            },
          ],
          details: { ok: true, stablePartId: partId, ...result },
        };
      } catch (error) {
        onError?.(error, { phase: "load_canvas.checkout" });
        return errorResult(
          "load_canvas",
          `Could not open the canvas: ${errorMessage(error)}`,
        );
      }
    },
  };
}

function buildRefreshCanvasDataTool(
  canvas: CanvasProvider,
  onError: ErrorSink,
): ToolDefinition {
  return {
    name: REFRESH_CANVAS_DATA_TOOL_NAME,
    label: "Refresh Canvas Data",
    description:
      "Re-fetch the live data behind a canvas's widgets without redrawing it — " +
      'use when the user says "refresh my <name> dashboard", "update the ' +
      'numbers", or "get the latest data" for a canvas. Pass a saved canvas ' +
      'name, or "current" (or omit) to refresh the canvas already open in this ' +
      "thread. This re-runs the saved data-source calls headlessly (no new " +
      "chart is drawn). Widgets bound to a per-user connector cannot refresh " +
      'unattended — those come back as "needs you"; report that to the user.',
    parameters: Type.Object({
      name: Type.Optional(
        Type.String({
          description:
            'Saved canvas name to refresh, or "current" / omit to refresh the ' +
            "canvas currently open in this thread.",
        }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const name = asString((params as Record<string, unknown>)?.name ?? "");

      let context: CanvasThreadContext;
      try {
        context = await canvas.context(signal);
      } catch (error) {
        onError?.(error, { phase: "refresh_canvas_data.context" });
        return errorResult(
          "refresh_canvas_data",
          "Could not resolve the canvas to refresh. Try again shortly.",
        );
      }

      let artifactId: string;
      let label: string;
      let stablePartId: string | null;
      if (!name || name.toLowerCase() === "current") {
        if (!context.currentCanvas) {
          return errorResult(
            "refresh_canvas_data",
            "There is no canvas open in this thread to refresh. Open one with " +
              "load_canvas first, or name the canvas to refresh.",
          );
        }
        artifactId = context.currentCanvas.artifactId;
        label = displayTitle(context.currentCanvas);
        stablePartId = context.currentCanvas.stablePartId;
      } else {
        const resolution = resolveCanvasByName(context.savedCanvases, name);
        if (resolution.kind === "ambiguous") {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `More than one saved canvas matches "${name}": ` +
                  `${candidateNames(resolution.candidates)}. Ask the user which ` +
                  "one to refresh.",
              },
            ],
            details: {
              ok: false,
              needsDisambiguation: true,
              query: name,
              candidates: resolution.candidates,
            },
          };
        }
        if (resolution.kind === "none") {
          const near =
            resolution.nearMatches.length > 0
              ? ` Closest saved canvases: ${candidateNames(resolution.nearMatches)}.`
              : "";
          return {
            content: [
              {
                type: "text" as const,
                text: `No saved canvas matches "${name}".${near}`,
              },
            ],
            details: {
              ok: false,
              notFound: true,
              query: name,
              nearMatches: resolution.nearMatches,
            },
          };
        }
        artifactId = resolution.item.artifactId;
        label = displayTitle(resolution.item);
        stablePartId = resolution.item.stablePartId;
      }

      try {
        const result = await canvas.refresh(artifactId, undefined, signal);
        return {
          content: [
            {
              type: "text" as const,
              text: formatRefreshSummary(label, stablePartId, result),
            },
          ],
          details: { ok: result.dispatched, stablePartId, ...result },
        };
      } catch (error) {
        onError?.(error, { phase: "refresh_canvas_data.refresh" });
        return errorResult(
          "refresh_canvas_data",
          `Could not refresh the canvas: ${errorMessage(error)}`,
        );
      }
    },
  };
}

function buildListCanvasesTool(
  canvas: CanvasProvider,
  onError: ErrorSink,
): ToolDefinition {
  return {
    name: LIST_CANVASES_TOOL_NAME,
    label: "List Canvases",
    description:
      "List the saved canvases in this thread's Space (name, id, version, last " +
      'updated). Use when the user asks "what dashboards do I have?", "list my ' +
      'canvases", or before load_canvas when you are unsure of the exact name. ' +
      "Only saved canvases are listed — unsaved draft emissions are excluded.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, signal) {
      let context: CanvasThreadContext;
      try {
        context = await canvas.context(signal);
      } catch (error) {
        onError?.(error, { phase: "list_canvases.context" });
        return errorResult(
          "list_canvases",
          "Could not list saved canvases for this thread. Try again shortly.",
        );
      }

      const saved = context.savedCanvases;
      if (saved.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "There are no saved canvases in this Space yet.",
            },
          ],
          details: { ok: true, canvases: [] },
        };
      }
      const header =
        context.spaceName != null && context.spaceName !== ""
          ? `Saved canvases in ${context.spaceName}:`
          : "Saved canvases in this Space:";
      return {
        content: [
          {
            type: "text" as const,
            text: [header, ...saved.map(formatCanvasLine)].join("\n"),
          },
        ],
        details: { ok: true, canvases: saved },
      };
    },
  };
}

function formatRefreshSummary(
  label: string,
  stablePartId: string | null,
  result: {
    dispatched: boolean;
    errorMessage: string | null;
    bindings: Array<{
      quality: string;
      outcome: string;
      reason: string | null;
      serverName: string;
      toolName: string;
    }>;
  },
): string {
  if (!result.dispatched) {
    return `Could not refresh "${label}": ${result.errorMessage ?? "refresh was not dispatched."}`;
  }
  if (result.bindings.length === 0) {
    return `"${label}" has no refreshable data-source bindings.`;
  }
  const good = result.bindings.filter(
    (b) => b.quality.toUpperCase() === "GOOD",
  ).length;
  // Match by outcome (the typed contract), keeping the legacy reason-substring
  // check only as a deploy-skew fallback for older Lambda payloads.
  const needsUser = result.bindings.filter(
    (b) =>
      b.outcome.toUpperCase() === "NEEDS_USER" ||
      (b.reason ?? "").toLowerCase().includes("needs you"),
  );
  const bad = result.bindings.filter(
    (b) => b.quality.toUpperCase() === "BAD",
  ).length;
  const lines = [
    `Refreshed "${label}": ${good}/${result.bindings.length} widget(s) updated.`,
  ];
  if (needsUser.length > 0) {
    // The headless refresher cannot use a per-user connector — but THIS turn
    // runs as the acting user, so the agent can complete the refresh itself
    // right now. Spell out the exact steps (source tools + the same-id re-emit
    // contract); vague "the owner must refresh" phrasing left models stopping
    // at a dead-end report.
    const sources = [
      ...new Set(
        needsUser
          .filter((b) => b.toolName)
          .map((b) =>
            b.serverName ? `${b.toolName} on ${b.serverName}` : b.toolName,
          ),
      ),
    ];
    const sourceList = sources.length > 0 ? ` (${sources.join("; ")})` : "";
    const reEmitTarget = stablePartId
      ? `the SAME part id "${stablePartId}"`
      : "the SAME part id the canvas already uses";
    lines.push(
      `${needsUser.length} widget(s) use a per-user connector the headless ` +
        `refresher cannot call — but YOU can, in this turn, acting for the ` +
        `user. Finish the refresh now: re-run the saved source tool ` +
        `call(s)${sourceList}, then re-emit the canvas json-render part with ` +
        `${reEmitTarget}, setting sourceToolCallId to the new tool call's id. ` +
        `Do not stop at reporting that the data is stale.`,
    );
  }
  if (bad > 0) {
    lines.push(
      `${bad} widget(s) failed to refresh and kept their last-good data.`,
    );
  }
  return lines.join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

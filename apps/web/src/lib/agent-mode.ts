// Single- vs multi-player mode derivation for the composer agent toggle.
//
// Single-player = a solo conversation between the current user and the agent.
// Multi-player  = another human is in the loop. In multi-player threads the
// agent toggle defaults OFF so casual human-to-human messages don't wake the
// agent; in single-player it defaults ON.
//
// Both composers consume this so the rule can't drift between them. The helper
// takes a minimal local mention shape (structurally satisfied by both
// ComposerMention and SpacesComposerMention) so it never imports from a
// composer module.

export interface AgentModeMention {
  targetType: "USER" | "AGENT" | "AGENT_PROFILE";
  targetId: string;
}

/**
 * A structured mention held in composer state: the picker-inserted token plus
 * the raw text it rendered into the draft (`@Name`). Structurally satisfied by
 * both ComposerMention and SpacesComposerMention.
 */
export interface DraftStructuredMention extends AgentModeMention {
  rawText: string;
}

/**
 * Minimal structural slice of a tenant mention target (MentionMenu's
 * MentionTarget satisfies it) — enough to mirror the server's typed-mention
 * text scan without importing from a composer module.
 */
export interface DraftMentionTarget {
  targetType: "USER" | "AGENT" | "AGENT_PROFILE";
  targetId: string;
  displayName: string;
  aliases?: string[];
}

export interface AgentModeMessage {
  role: string;
  senderType?: string | null;
  senderId?: string | null;
}

/**
 * Server-authoritative Thread Mode (THINK-136). When present it wins over the
 * local heuristics: the server counts real participants (including a user
 * @mentioned but not yet replied) and honours the per-thread override, which
 * the client cannot see from message history alone.
 */
export type ServerThreadMode = "AGENT" | "MULTIPLAYER";

export interface DeriveAgentDefaultInput {
  /** The signed-in user. When unknown, sender-based detection is skipped. */
  currentUserId?: string | null;
  /** Prior thread messages. Empty/omitted for a brand-new thread. */
  threadMessages?: AgentModeMessage[];
  /** Mentions present in the current composer draft. */
  draftMentions?: AgentModeMention[];
  /**
   * Server-derived Thread Mode. When set it wins over the local heuristics;
   * when null/undefined (legacy data or a not-yet-created thread) the heuristic
   * below is the fallback, unchanged.
   */
  serverMode?: ServerThreadMode | null;
}

export type AgentMode = "single" | "multi";

/**
 * A thread is multi-player when another human is participating — detected by:
 *  - another human having authored a USER message (requires a known
 *    currentUserId to tell "another human" from the current user), OR
 *  - the current draft @mentioning another user.
 *
 * Agent mentions never make a thread multi-player.
 *
 * Known limitation: a user @mentioned in thread history who has not yet replied
 * is not detected here — historical messages don't carry structured mentions in
 * this view, so only authored messages and the live draft are considered. Such
 * a thread reads as single-player until the mentioned user posts.
 */
export function deriveAgentMode(input: DeriveAgentDefaultInput): AgentMode {
  const { currentUserId, threadMessages = [], draftMentions = [] } = input;

  const otherHumanPosted = currentUserId
    ? threadMessages.some(
        (message) =>
          message.role?.toUpperCase() === "USER" &&
          message.senderType !== "agent" &&
          Boolean(message.senderId) &&
          message.senderId !== currentUserId,
      )
    : false;

  return otherHumanPosted || draftMentionsOtherUser(input) ? "multi" : "single";
}

/**
 * Whether the current draft @mentions a human other than the current user.
 * When the current user is unknown, any user mention counts as "other".
 */
function draftMentionsOtherUser(input: DeriveAgentDefaultInput): boolean {
  const { currentUserId, draftMentions = [] } = input;
  return draftMentions.some(
    (mention) =>
      mention.targetType === "USER" && mention.targetId !== currentUserId,
  );
}

/**
 * Resolves the draft mentions the toggle derivation should see, from the live
 * composer text:
 *  - structured (picker-inserted) mentions survive only while their rawText is
 *    still present in the text — the same filter submit applies, so a deleted
 *    `@Name` stops counting immediately (not only at send);
 *  - plain-text `@Name` typed against a known USER mention target counts too,
 *    mirroring the server's `findTextMentions` scan (boundary-anchored,
 *    case-insensitive match of `@` + displayName/alias) so the toggle agrees
 *    with what the server will parse at send. Only USER targets other than the
 *    current user are scanned; agent aliases keep their existing force-on path.
 */
export function resolveDraftMentions(input: {
  text: string;
  structuredMentions?: DraftStructuredMention[];
  mentionTargets?: DraftMentionTarget[];
  currentUserId?: string | null;
}): AgentModeMention[] {
  const {
    text,
    structuredMentions = [],
    mentionTargets = [],
    currentUserId,
  } = input;

  const resolved = new Map<string, AgentModeMention>();
  const add = (mention: AgentModeMention) => {
    resolved.set(`${mention.targetType}:${mention.targetId}`, {
      targetType: mention.targetType,
      targetId: mention.targetId,
    });
  };

  for (const mention of structuredMentions) {
    if (text.includes(mention.rawText)) add(mention);
  }

  if (text.includes("@")) {
    for (const target of mentionTargets) {
      if (target.targetType !== "USER") continue;
      if (currentUserId && target.targetId === currentUserId) continue;
      const typed = [target.displayName, ...(target.aliases ?? [])].some(
        (alias) => {
          const trimmed = alias?.trim();
          if (!trimmed) return false;
          return new RegExp(
            `(^|\\s)@${escapeRegExp(trimmed)}(?=$|\\s|[.,!?;:])`,
            "iu",
          ).test(text);
        },
      );
      if (typed) add(target);
    }
  }

  return [...resolved.values()];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Derives the agent toggle's default state: ON in single-player, OFF in
 * multi-player. Callers use this to set the initial per-thread default; a
 * user's manual override then persists within the thread.
 *
 * A draft that @mentions another human outranks everything else: the server
 * Thread Mode is a snapshot from before the draft existed, and the server will
 * count that mention when the message lands (participants are inserted before
 * dispatch-mode resolution). A draft user-mention can only force `multi`
 * (uncheck) — it never converts a MULTIPLAYER thread to `single`.
 *
 * Otherwise, when the server Thread Mode is known (`serverMode`), it is
 * authoritative and wins over the local heuristics: AGENT → default on,
 * MULTIPLAYER → default off. This closes the documented blind spot (a user
 * @mentioned but not yet replied) that the message-history heuristic can't
 * see. When absent the heuristic is the fallback, unchanged.
 */
export function deriveAgentDefault(input: DeriveAgentDefaultInput): {
  mode: AgentMode;
  agentDefaultOn: boolean;
} {
  if (draftMentionsOtherUser(input)) {
    return { mode: "multi", agentDefaultOn: false };
  }
  if (input.serverMode) {
    const mode: AgentMode = input.serverMode === "AGENT" ? "single" : "multi";
    return { mode, agentDefaultOn: mode === "single" };
  }
  const mode = deriveAgentMode(input);
  return { mode, agentDefaultOn: mode === "single" };
}

/**
 * The explicit per-message dispatch tri-state sent to the server (THINK-136
 * KTD2). Mirrors the `AgentDispatchRequest` GraphQL enum wire values.
 */
export type AgentDispatchRequestValue = "AUTO" | "FORCE_ON" | "FORCE_OFF";

export interface AgentToggleState {
  /** True once the user has manually toggled the agent control this draft. */
  overridden: boolean;
  /** Current effective enabled state of the agent toggle. */
  enabled: boolean;
}

/**
 * Maps the composer's agent-toggle state to the explicit dispatch tri-state:
 *  - untouched (no manual override) → AUTO (server decides from Thread Mode)
 *  - manually turned ON             → FORCE_ON
 *  - manually turned OFF            → FORCE_OFF
 *
 * The server gate resolves AUTO from mentions + Thread Mode, so a misclassifying
 * client can no longer force wrong dispatch behavior by omission.
 */
export function deriveAgentDispatch(
  state: AgentToggleState,
): AgentDispatchRequestValue {
  if (!state.overridden) return "AUTO";
  return state.enabled ? "FORCE_ON" : "FORCE_OFF";
}

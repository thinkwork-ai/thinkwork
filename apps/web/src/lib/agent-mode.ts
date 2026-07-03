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

  const draftMentionsOtherUser = draftMentions.some(
    (mention) =>
      mention.targetType === "USER" && mention.targetId !== currentUserId,
  );

  return otherHumanPosted || draftMentionsOtherUser ? "multi" : "single";
}

/**
 * Derives the agent toggle's default state: ON in single-player, OFF in
 * multi-player. Callers use this to set the initial per-thread default; a
 * user's manual override then persists within the thread.
 *
 * When the server Thread Mode is known (`serverMode`), it is authoritative and
 * wins over the local heuristics: AGENT → default on, MULTIPLAYER → default
 * off. This closes the documented blind spot (a user @mentioned but not yet
 * replied) that the message-history heuristic can't see. When absent the
 * heuristic is the fallback, unchanged.
 */
export function deriveAgentDefault(input: DeriveAgentDefaultInput): {
  mode: AgentMode;
  agentDefaultOn: boolean;
} {
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

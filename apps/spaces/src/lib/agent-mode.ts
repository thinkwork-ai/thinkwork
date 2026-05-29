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
  targetType: "USER" | "AGENT";
  targetId: string;
}

export interface AgentModeMessage {
  role: string;
  senderType?: string | null;
  senderId?: string | null;
}

export interface DeriveAgentDefaultInput {
  /** The signed-in user. When unknown, sender-based detection is skipped. */
  currentUserId?: string | null;
  /** Prior thread messages. Empty/omitted for a brand-new thread. */
  threadMessages?: AgentModeMessage[];
  /** Mentions present in the current composer draft. */
  draftMentions?: AgentModeMention[];
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
 */
export function deriveAgentDefault(input: DeriveAgentDefaultInput): {
  mode: AgentMode;
  agentDefaultOn: boolean;
} {
  const mode = deriveAgentMode(input);
  return { mode, agentDefaultOn: mode === "single" };
}

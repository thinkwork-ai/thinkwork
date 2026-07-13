/**
 * Block Kit composition seam (KTD7): every factory-posted surface (milestones,
 * escalations, acks, results, board) builds its blocks through this module, so
 * Slack's hard limits are enforced in exactly one place.
 *
 * Slack hard limits (exceeding ANY of them makes chat.postMessage reject the
 * WHOLE message, so the post would silently never appear — the original
 * incident class questions.ts was built around):
 *   - button `plain_text` label: 75 chars
 *   - button `value`: 2000 chars
 *   - section `text`: 3000 chars
 *   - blocks per message: 50
 *   - elements per actions block: 25
 *
 * Truncation here always leaves a visible note — an elided message must read
 * as elided, never as complete.
 */

/** Slack `plain_text` button label hard limit. */
export const BUTTON_LABEL_MAX = 75;

/** Slack button `value` hard limit. */
export const BUTTON_VALUE_MAX = 2000;

/**
 * Keep a full answer label inside a button `value` JSON up to ~1800 chars so
 * the whole serialized value stays under BUTTON_VALUE_MAX with room for the
 * JSON envelope (key + indices + quoting).
 */
export const VALUE_ANSWER_MAX = 1800;

/** Slack section `text` hard limit is 3000 — truncate with headroom for the note. */
export const SECTION_TEXT_MAX = 2900;

/** Slack blocks-per-message hard limit. */
export const MAX_BLOCKS_PER_MESSAGE = 50;

/** Slack elements-per-actions-block hard limit. */
export const MAX_ACTIONS_ELEMENTS = 25;

/** A Block Kit block — kept loose; the Slack SDK types never load in tests. */
export type SlackBlock = Record<string, unknown>;

export function truncate(text: string, max: number, suffix = "…"): string {
  if (text.length <= max) return text;
  return text.slice(0, max - suffix.length) + suffix;
}

/**
 * A mrkdwn section, truncated to Slack's 3000-char limit with a visible note
 * replacing the tail — the full text always lives at the source (Linear, the
 * log file), so nothing is lost, only elided.
 */
export function section(text: string): SlackBlock {
  let t = text;
  if (t.length > SECTION_TEXT_MAX) {
    t = t.slice(0, SECTION_TEXT_MAX) + "\n_(truncated)_";
  }
  return { type: "section", text: { type: "mrkdwn", text: t } };
}

/** A context block: the small grey line under a message. */
export function context(text: string): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: truncate(text, SECTION_TEXT_MAX) }],
  };
}

/**
 * A section with two-column fields (label/value pairs read well on a phone).
 * Slack caps fields at 10 per section; extras are dropped with a note field.
 */
export function fields(items: readonly string[]): SlackBlock {
  const capped =
    items.length > 10
      ? [...items.slice(0, 9), `_(+${items.length - 9} more)_`]
      : [...items];
  return {
    type: "section",
    fields: capped.map((f) => ({ type: "mrkdwn", text: truncate(f, 2000) })),
  };
}

export function divider(): SlackBlock {
  return { type: "divider" };
}

export interface ButtonSpec {
  actionId: string;
  label: string;
  /** Serialized value payload; MUST fit BUTTON_VALUE_MAX (throws otherwise —
   * a silently-cut value is corrupt JSON and a dead button). */
  value?: string;
  style?: "primary" | "danger";
}

/** One button element. Labels truncate to 75; values must fit — see ButtonSpec. */
export function button(spec: ButtonSpec): SlackBlock {
  if (spec.value !== undefined && spec.value.length > BUTTON_VALUE_MAX) {
    throw new Error(
      `slack button value exceeds ${BUTTON_VALUE_MAX} chars (${spec.value.length}) — action_id ${spec.actionId}`,
    );
  }
  return {
    type: "button",
    action_id: spec.actionId,
    text: {
      type: "plain_text",
      text: truncate(spec.label, BUTTON_LABEL_MAX),
      emoji: true,
    },
    ...(spec.value !== undefined ? { value: spec.value } : {}),
    ...(spec.style !== undefined ? { style: spec.style } : {}),
  };
}

/** An actions block. Elements past Slack's 25-per-block cap are dropped. */
export function actions(buttons: readonly ButtonSpec[]): SlackBlock {
  return {
    type: "actions",
    elements: buttons.slice(0, MAX_ACTIONS_ELEMENTS).map(button),
  };
}

/**
 * An image block. `altText` is REQUIRED here — this is the one place the
 * accessibility field cannot be forgotten (Slack also rejects images without
 * it, so an empty alt_text is a silently-unposted message).
 */
export function image(imageUrl: string, altText: string): SlackBlock {
  const alt = altText.trim();
  if (alt === "") {
    throw new Error("slack image block requires non-empty alt_text");
  }
  return { type: "image", image_url: imageUrl, alt_text: truncate(alt, 2000) };
}

export interface ComposedMessage {
  /** Plain-text notification/accessibility fallback — always non-empty. */
  text: string;
  blocks: SlackBlock[];
}

/**
 * Final assembly: enforce the 50-blocks-per-message ceiling (trim with a
 * visible context note rather than reject — a trimmed board beats no board)
 * and guarantee a non-empty plain-text fallback (Slack requires it as the
 * notification text; without it the push notification is blank).
 */
export function composeMessage(
  blocks: readonly SlackBlock[],
  fallbackText: string,
): ComposedMessage {
  let finalBlocks = [...blocks];
  if (finalBlocks.length > MAX_BLOCKS_PER_MESSAGE) {
    const dropped = finalBlocks.length - (MAX_BLOCKS_PER_MESSAGE - 1);
    finalBlocks = finalBlocks.slice(0, MAX_BLOCKS_PER_MESSAGE - 1);
    finalBlocks.push(context(`_(+${dropped} more blocks trimmed)_`));
  }
  const text = fallbackText.trim() === "" ? "Factory update" : fallbackText;
  return { text, blocks: finalBlocks };
}

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { usePromptInputAttachments } from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import type { SkillOption } from "@/components/spaces/SkillMenu";

/**
 * Contenteditable composer input that renders inline `/slug` skill tokens as
 * atomic pills (Sparkles icon + display name), the way Codex/Slack/Notion render
 * mentions (plan 2026-06-04-004 follow-up). A drop-in replacement for
 * PromptInputTextarea: it keeps the same controlled `value` (a plain string with
 * `/slug` tokens) ↔ `onChange(value)` contract, so the slash popup, mention
 * detection, `extractPinnedSkillSlugs`, and all the backend wiring are unchanged.
 *
 * The editor is manually reconciled (not React-rendered children) to avoid the
 * caret-jump that controlled contenteditable suffers: the DOM is only rewritten
 * when `value` changes from OUTSIDE (a pill insert, a clear), never on keystroke.
 */

// Inline-token icons. Shared wrapper keeps every token's icon on
// the text baseline at the same size — this is the seam for future taggable
// resource kinds (plugins, knowledge bases, …).
const ICON_ATTRS =
  'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.125em;margin-right:3px" aria-hidden="true"';
const SPARKLES_SVG = `<svg ${ICON_ATTRS}><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>`;
const USER_SVG = `<svg ${ICON_ATTRS}><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
const BOT_SVG = `<svg ${ICON_ATTRS}><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`;
const TARGET_ARROW_SVG = `<svg ${ICON_ATTRS}><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 7a5 5 0 1 0 5 5"/><path d="M13 3.055a9 9 0 1 0 7.941 7.945"/><path d="M15 6v3h3l3 -3h-3v-3l-3 3"/><path d="M15 9l-3 3"/></svg>`;

/** A committed mention the editor should render as an inline pill. */
export interface TokenMention {
  displayName: string;
  targetType: "USER" | "AGENT" | "AGENT_PROFILE";
  rawText?: string;
}

interface SkillTokenSegment {
  type: "text" | "skill" | "mention" | "goal";
  text?: string;
  slug?: string;
  label?: string;
  displayName?: string;
  targetType?: "USER" | "AGENT" | "AGENT_PROFILE";
  trigger?: "@" | "#";
}

const slugRe = /(^|\s)\/([\w.'-]+)/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse the serialized value into text + token (skill / mention) segments.
 * Skills are `/slug` tokens matched against the catalog; mentions are
 * `@displayName` substrings matched against the committed mention list (display
 * names can contain spaces, so they're matched literally, not by regex word).
 */
export function parseValueToSegments(
  value: string,
  catalog: SkillOption[],
  mentions: TokenMention[] = [],
): SkillTokenSegment[] {
  const bySlug = new Map(catalog.map((s) => [s.slug, s]));
  const spans: { start: number; end: number; seg: SkillTokenSegment }[] = [];

  slugRe.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = slugRe.exec(value))) {
    const slug = match[2]!;
    if (slug === "goal") {
      const start = match.index + match[1]!.length;
      spans.push({
        start,
        end: start + 1 + slug.length,
        seg: {
          type: "goal",
        },
      });
      continue;
    }
    if (!bySlug.has(slug)) continue;
    const start = match.index + match[1]!.length;
    spans.push({
      start,
      end: start + 1 + slug.length,
      seg: {
        type: "skill",
        slug,
        label: bySlug.get(slug)!.displayName?.trim() || slug,
      },
    });
  }

  const seenMentionTokens = new Set<string>();
  for (const mention of mentions) {
    const name = mention.displayName;
    if (!name) continue;
    const trigger =
      mention.rawText?.trim().startsWith("#") ||
      mention.targetType === "AGENT_PROFILE"
        ? "#"
        : "@";
    const token = mention.rawText?.trim() || `${trigger}${name}`;
    if (seenMentionTokens.has(token)) continue;
    seenMentionTokens.add(token);
    const re = new RegExp(`(^|\\s)(${escapeRegExp(token)})`, "g");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(value))) {
      const start = mm.index + mm[1]!.length;
      spans.push({
        start,
        end: start + token.length,
        seg: {
          type: "mention",
          displayName: name,
          targetType: mention.targetType,
          ...(trigger === "#" ? { trigger } : {}),
        },
      });
    }
  }

  // Earliest start wins; at the same start the longer token wins (so
  // "@Brett Odom" beats "@Brett"). Then drop overlaps greedily.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: SkillTokenSegment[] = [];
  let last = 0;
  for (const span of spans) {
    if (span.start < last) continue; // overlaps an already-chosen token
    if (span.start > last) {
      segments.push({ type: "text", text: value.slice(last, span.start) });
    }
    segments.push(span.seg);
    last = span.end;
  }
  if (last < value.length) {
    segments.push({ type: "text", text: value.slice(last) });
  }
  return segments;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Every token kind shares one inline style — same font size + baseline as the
// surrounding text, a leading icon, and a bit of horizontal breathing room.
const TOKEN_CLASS =
  "mx-1 select-none align-baseline font-medium text-[#1d6fd6] dark:text-[#7cc0ff]";

function makeSkillPill(slug: string, label: string): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute("contenteditable", "false");
  span.dataset.slug = slug;
  span.className = `skill-pill ${TOKEN_CLASS}`;
  span.innerHTML = `${SPARKLES_SVG}<span>${escapeHtml(label)}</span>`;
  return span;
}

function makeGoalPill(): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute("contenteditable", "false");
  span.dataset.goal = "true";
  span.className = `goal-pill ${TOKEN_CLASS}`;
  span.innerHTML = `${TARGET_ARROW_SVG}<span>Goal</span>`;
  return span;
}

function makeMentionPill(
  displayName: string,
  targetType: "USER" | "AGENT" | "AGENT_PROFILE",
  trigger: "@" | "#" = targetType === "AGENT_PROFILE" ? "#" : "@",
): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute("contenteditable", "false");
  span.dataset.mention = displayName;
  span.dataset.mentionTrigger = trigger;
  span.className = `mention-pill ${TOKEN_CLASS}`;
  const icon =
    targetType === "AGENT" || targetType === "AGENT_PROFILE"
      ? BOT_SVG
      : USER_SVG;
  span.innerHTML = `${icon}<span>${escapeHtml(displayName)}</span>`;
  return span;
}

/** Render segments into the editor element, replacing its children. */
export function renderSegments(
  el: HTMLElement,
  segments: SkillTokenSegment[],
): void {
  el.replaceChildren();
  for (const seg of segments) {
    if (seg.type === "goal") {
      el.appendChild(makeGoalPill());
    } else if (seg.type === "skill") {
      el.appendChild(makeSkillPill(seg.slug!, seg.label!));
    } else if (seg.type === "mention") {
      el.appendChild(
        makeMentionPill(seg.displayName!, seg.targetType!, seg.trigger),
      );
    } else if (seg.text) {
      el.appendChild(document.createTextNode(seg.text));
    }
  }
  // A trailing zero-width space keeps the caret placeable after a final pill.
  if (segments.length && segments[segments.length - 1]!.type !== "text") {
    el.appendChild(document.createTextNode("​"));
  }
}

/** Serialize the editor DOM back to the canonical value string. */
export function serializeEditor(el: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? "").replace(/​/g, "");
      } else if (child instanceof HTMLElement) {
        if (child.dataset.slug) {
          out += `/${child.dataset.slug}`;
        } else if (child.dataset.goal) {
          out += "/goal";
        } else if (child.dataset.mention) {
          out += `${child.dataset.mentionTrigger ?? "@"}${child.dataset.mention}`;
        } else if (child.tagName === "BR") {
          out += "\n";
        } else {
          if (
            child.tagName === "DIV" &&
            out.length > 0 &&
            !out.endsWith("\n")
          ) {
            out += "\n";
          }
          walk(child);
        }
      }
    });
  };
  walk(el);
  return out;
}

function placeCaretAtEnd(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export interface SkillTokenInputProps {
  value: string;
  onChange: (value: string) => void;
  catalog: SkillOption[];
  /** Committed mentions to render as inline pills (in addition to skills). */
  mentions?: TokenMention[];
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  autoFocus?: boolean;
}

/**
 * Minimal textarea-like surface exposed via ref so the existing speech-to-text
 * button (which reads/writes `.value` on a textarea) keeps working against the
 * contenteditable editor without changes.
 */
export interface SkillTokenInputHandle {
  value: string;
  focus: () => void;
  dispatchEvent: (event: Event) => boolean;
}

export const SkillTokenInput = forwardRef<
  SkillTokenInputHandle,
  SkillTokenInputProps
>(function SkillTokenInput(
  {
    value,
    onChange,
    catalog,
    mentions = [],
    onKeyDown,
    placeholder,
    disabled,
    className,
    autoFocus,
    ...aria
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      get value() {
        return editorRef.current ? serializeEditor(editorRef.current) : "";
      },
      set value(next: string) {
        onChange(next);
      },
      focus() {
        editorRef.current?.focus();
      },
      dispatchEvent() {
        return true;
      },
    }),
    [onChange],
  );
  // The value the DOM currently represents — so we only rewrite the DOM (and
  // disturb the caret) when `value` changes from outside, not on keystroke.
  const lastSerializedRef = useRef<string | null>(null);

  // Reconcile DOM from the controlled value on external changes only.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastSerializedRef.current) return;
    renderSegments(el, parseValueToSegments(value, catalog, mentions));
    lastSerializedRef.current = value;
    if (document.activeElement === el) placeCaretAtEnd(el);
  }, [value, catalog, mentions]);

  useEffect(() => {
    if (autoFocus && !disabled) editorRef.current?.focus();
  }, [autoFocus, disabled]);

  const attachments = usePromptInputAttachments();

  const handleInput = () => {
    const el = editorRef.current;
    if (!el) return;
    const serialized = serializeEditor(el);
    lastSerializedRef.current = serialized;
    onChange(serialized);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === "Enter") {
      if (event.nativeEvent.isComposing) return;
      if (event.shiftKey) return; // shift+Enter inserts a newline
      event.preventDefault();
      const form = editorRef.current?.closest("form");
      const submitButton = form?.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (submitButton?.disabled) return;
      form?.requestSubmit();
      return;
    }

    // Backspace on an empty editor removes the last attachment (parity with
    // PromptInputTextarea).
    if (
      event.key === "Backspace" &&
      serializeEditor(editorRef.current!).length === 0 &&
      attachments.files.length > 0
    ) {
      event.preventDefault();
      const last = attachments.files.at(-1);
      if (last) attachments.remove(last.id);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    // Always paste as plain text — never inject foreign HTML into the editor.
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  // Treat whitespace-only content as empty so the placeholder always shows when
  // nothing meaningful is entered. The browser leaves a stray <br> after the
  // field is cleared, which serializes to "\n" — without trimming, that would
  // suppress the placeholder even though the composer looks empty.
  const isEmpty = value.trim().length === 0;

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      aria-label={aria["aria-label"]}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className={cn(
        "skill-token-input relative max-h-48 min-h-16 w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-3 text-base outline-none",
        isEmpty &&
          "before:pointer-events-none before:absolute before:left-3 before:top-3 before:text-muted-foreground before:content-[attr(data-placeholder)]",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    />
  );
});

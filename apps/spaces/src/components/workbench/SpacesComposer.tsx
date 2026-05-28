import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { IconPaperclip, IconPlanet } from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AtSign, Bot } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import {
  filterMentionTargets,
  MentionMenu,
  type MentionTarget,
} from "@/components/spaces/MentionMenu";
import { SPACES_COMPOSER_FOCUS_EVENT } from "@/lib/composer-focus";
import { cn } from "@/lib/utils";

export interface SpacesComposerMention {
  targetType: "USER" | "AGENT";
  targetId: string;
  displayName: string;
  rawText: string;
}

export interface SpacesComposerSpaceOption {
  id: string;
  name: string;
}

interface SpacesComposerProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Fired on submit. `files` is the user's attached File objects
   * (.xlsx / .xls / .csv only — `accept` constrains the picker).
   * Empty array when no files attached.
   */
  onSubmit: (
    files: File[],
    mentions: SpacesComposerMention[],
    agentRequested: boolean,
  ) => void;
  mentionTargets?: MentionTarget[];
  spaces?: SpacesComposerSpaceOption[];
  selectedSpaceId?: string | null;
  selectedSpaceIsDefault?: boolean;
  onSelectedSpaceChange?: (spaceId: string) => void;
  disabled?: boolean;
  isSubmitting?: boolean;
  error?: string | null;
}

/**
 * Empty-thread composer (plan-012 U13; finance pilot U1 attachments
 * landed in a follow-on after U1 deferred this surface).
 *
 * Renders the AI Elements <PromptInput> with the attachments chip row
 * and a paperclip trigger so the user can attach an .xlsx / .csv
 * BEFORE the thread exists. SpacesWorkbench's handleSubmit owns the
 * full sequence: createThread (sans firstMessage when files attached)
 * → upload via presign+finalize → sendMessage with
 * metadata.attachments → navigate.
 *
 * Submit gating: either non-empty text OR at least one attached file
 * enables submit. A file-only turn is valid; the prompt is optional.
 */
export function SpacesComposer({
  value,
  onChange,
  onSubmit,
  mentionTargets = [],
  spaces = [],
  selectedSpaceId,
  selectedSpaceIsDefault = true,
  onSelectedSpaceChange,
  disabled = false,
  isSubmitting = false,
  error,
}: SpacesComposerProps) {
  const [mentions, setMentions] = useState<SpacesComposerMention[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const spacePickerColorClass = selectedSpaceIsDefault
    ? "text-muted-foreground hover:text-foreground"
    : "text-foreground hover:text-foreground/80";
  const spacePickerIconClass = selectedSpaceIsDefault
    ? "text-muted-foreground"
    : "text-foreground";
  const mentionQuery = useMemo(() => currentMentionQuery(value), [value]);
  const mentionOptions = useMemo(
    () =>
      mentionQuery === null
        ? []
        : filterMentionTargets(mentionTargets, mentionQuery),
    [mentionQuery, mentionTargets],
  );
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const agentForcedOn = hasDefaultAgentMentionAlias(value);
  const effectiveAgentEnabled = agentForcedOn || agentEnabled;

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionQuery, mentionOptions.length]);

  useEffect(() => {
    if (agentForcedOn) setAgentEnabled(true);
  }, [agentForcedOn]);

  // Re-runs when the textarea's disabled flag flips. Mount-time focus
  // (autoFocus + the rAF/setTimeout pair) silently no-ops while the
  // composer is disabled — e.g. on /new arrival while spaces/computers
  // are still fetching. Without re-firing on the disabled→enabled
  // transition, the textarea would sit unfocused after fetch completes
  // and the user would have to click it.
  const isComposerDisabled = disabled || isSubmitting;
  useEffect(() => {
    function focusComposerInput() {
      const input = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Send message"]',
      );
      input?.focus();
    }

    if (!isComposerDisabled) {
      focusComposerInput();
    }
    const animationFrame = isComposerDisabled
      ? 0
      : window.requestAnimationFrame(focusComposerInput);
    const timeout = isComposerDisabled
      ? 0
      : window.setTimeout(focusComposerInput, 0);
    window.addEventListener(SPACES_COMPOSER_FOCUS_EVENT, focusComposerInput);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      if (timeout) window.clearTimeout(timeout);
      window.removeEventListener(
        SPACES_COMPOSER_FOCUS_EVENT,
        focusComposerInput,
      );
    };
  }, [isComposerDisabled]);

  async function handlePromptSubmit(message: PromptInputMessage) {
    if (disabled || isSubmitting) return;
    const files = await fileUiPartsToFiles(message.files);
    const hasText = value.trim().length > 0;
    if (!hasText && files.length === 0) return;
    const submittedMentions = mentions.filter((mention) =>
      value.includes(mention.rawText),
    );
    onSubmit(files, submittedMentions, effectiveAgentEnabled);
    setMentions([]);
  }

  function selectMention(target: MentionTarget) {
    const replacement = `@${target.displayName} `;
    const query = mentionQuery ?? "";
    const prefix = value.slice(0, value.length - query.length - 1);
    onChange(`${prefix}${replacement}`);
    setMentions((current) => [
      ...current.filter(
        (mention) =>
          !(
            mention.targetType === target.targetType &&
            mention.targetId === target.targetId
          ),
      ),
      {
        targetType: target.targetType,
        targetId: target.targetId,
        displayName: target.displayName,
        rawText: replacement.trim(),
      },
    ]);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery === null || mentionOptions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveMentionIndex((index) => (index + 1) % mentionOptions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveMentionIndex(
        (index) => (index - 1 + mentionOptions.length) % mentionOptions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target =
        mentionOptions[
          Math.min(activeMentionIndex, Math.max(mentionOptions.length - 1, 0))
        ];
      if (target) selectMention(target);
    }
  }

  const agentToggleTitle = agentForcedOn
    ? "Agent handling is required by @agent or @think"
    : effectiveAgentEnabled
      ? "Agent will respond"
      : "Send without waking the agent";

  return (
    <div className="grid gap-2">
      <div className="relative">
        {mentionQuery !== null ? (
          <MentionMenu
            targets={mentionTargets}
            query={mentionQuery}
            activeIndex={activeMentionIndex}
            placement="bottom"
            onSelect={selectMention}
          />
        ) : null}
        <PromptInput
          // Override the shared InputGroup focus styling so the empty-thread
          // composer reads as borderless when focused — no background shift,
          // no inner ring, no border-color flip. Border stays at
          // border-border/80 in every state. Other PromptInput consumers
          // (in-thread FollowUpComposer) keep the default InputGroup look.
          className="rounded-2xl border border-border/80 bg-transparent shadow-none dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-border/80 has-[[data-slot=input-group-control]:focus-visible]:ring-0"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          maxFiles={5}
          maxFileSize={25 * 1024 * 1024}
          multiple
          onSubmit={handlePromptSubmit}
        >
          <PromptInputBody>
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <PromptInputTextarea
              ref={textareaRef}
              aria-label="Send message"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Type @ to mention a person or agent"
              disabled={isComposerDisabled}
              autoFocus
            />
          </PromptInputBody>
          <PromptInputFooter className="px-2 pb-2">
            <PromptInputTools>
              <button
                type="button"
                onClick={() => {
                  if (!agentForcedOn) setAgentEnabled((value) => !value);
                }}
                aria-label="Send to agent"
                aria-pressed={effectiveAgentEnabled}
                title={agentToggleTitle}
                disabled={isComposerDisabled || agentForcedOn}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-80",
                  effectiveAgentEnabled && "text-[#54a9ff]",
                )}
              >
                <Bot className="size-5" />
              </button>
              {spaces.length > 0 && selectedSpaceId && onSelectedSpaceChange ? (
                <Select
                  value={selectedSpaceId}
                  onValueChange={onSelectedSpaceChange}
                  disabled={disabled || isSubmitting}
                >
                  <SelectTrigger
                    aria-label="Select Space"
                    title="Choose a Space"
                    className={cn(
                      "h-8 max-w-[190px] gap-1.5 rounded-md border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted focus:ring-0",
                      spacePickerColorClass,
                    )}
                  >
                    <IconPlanet
                      stroke={2}
                      className={cn("size-4 shrink-0", spacePickerIconClass)}
                    />
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {spaces.map((space) => (
                      <SelectItem key={space.id} value={space.id}>
                        {space.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <PromptInputButton
                type="button"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(`${value}@`)}
                aria-label="Mention"
                title="Mention"
              >
                <AtSign className="h-4 w-4" />
              </PromptInputButton>
              <PromptInputAttachButton />
            </PromptInputTools>
            <div className="flex items-center gap-1">
              <PromptInputSpeechButton
                textareaRef={textareaRef}
                onTranscriptionChange={onChange}
                aria-label="Voice input"
                title="Voice input"
                className="text-muted-foreground hover:text-foreground"
                disabled={disabled || isSubmitting}
              />
              <ConditionalSubmit
                hasText={value.trim().length > 0}
                disabled={disabled}
                isSubmitting={isSubmitting}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Submit button that disables when there's neither text nor any
 * attached file. Lives inside the PromptInput so it can read the
 * attachments context — the parent component doesn't have direct
 * access to the files list without rewiring through
 * PromptInputProvider.
 */
function ConditionalSubmit({
  hasText,
  disabled,
  isSubmitting,
}: {
  hasText: boolean;
  disabled: boolean;
  isSubmitting: boolean;
}) {
  const attachments = usePromptInputAttachments();
  const hasFile = attachments.files.length > 0;
  const canSubmit = (hasText || hasFile) && !disabled && !isSubmitting;
  return (
    <PromptInputSubmit
      disabled={!canSubmit}
      status={isSubmitting ? "submitted" : undefined}
      aria-label={isSubmitting ? "Starting" : "Start"}
    />
  );
}

/**
 * Paperclip trigger that opens the native file picker via the
 * PromptInput's attachments context. Same shape as the equivalent
 * helper in `TaskThreadView.tsx`.
 */
function PromptInputAttachButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      type="button"
      variant="ghost"
      className="text-muted-foreground hover:text-foreground"
      onClick={() => attachments.openFileDialog()}
      aria-label="Attach file"
      title="Attach a spreadsheet"
    >
      <IconPaperclip stroke={2} className="h-4 w-4" />
    </PromptInputButton>
  );
}

/**
 * Convert AI-Elements FileUIPart blob URLs back to File objects so
 * the upload helper can POST the bytes. PromptInput's onSubmit hands
 * us `{ type: 'file', url: blob://..., mediaType, filename }`.
 */
async function fileUiPartsToFiles(
  parts: Array<{ url?: string; mediaType?: string; filename?: string }>,
): Promise<File[]> {
  if (!parts || parts.length === 0) return [];
  const files: File[] = [];
  for (const part of parts) {
    if (!part?.url) continue;
    try {
      const response = await fetch(part.url);
      const blob = await response.blob();
      files.push(
        new File([blob], part.filename ?? "attachment", {
          type: part.mediaType ?? blob.type ?? "application/octet-stream",
        }),
      );
    } catch (err) {
      console.warn(
        `[SpacesComposer] failed to reify attached file ${part.filename}:`,
        err,
      );
    }
  }
  return files;
}

function currentMentionQuery(content: string) {
  const match = /(?:^|\s)@([\w.'-]*)$/u.exec(content);
  return match ? match[1] : null;
}

function hasDefaultAgentMentionAlias(content: string) {
  return /(?:^|\s)@(agent|think)\b/iu.test(content);
}

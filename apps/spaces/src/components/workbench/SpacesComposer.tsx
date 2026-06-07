import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  SkillTokenInput,
  type SkillTokenInputHandle,
} from "@/components/workbench/SkillTokenInput";
import { ComposerModelPicker } from "@/components/workbench/ComposerModelPicker";
import { IconPaperclip, IconPlanet } from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Bot } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import {
  filterMentionTargets,
  MentionMenu,
  type MentionTarget,
} from "@/components/spaces/MentionMenu";
import { SkillMenu, type SkillOption } from "@/components/spaces/SkillMenu";
import {
  extractPinnedSkillSlugs,
  useComposerSkillPins,
} from "@/components/workbench/useComposerSkillPins";
import { toast } from "sonner";
import { SPACES_COMPOSER_FOCUS_EVENT } from "@/lib/composer-focus";
import { cn } from "@/lib/utils";
import { deriveAgentDefault } from "@/lib/agent-mode";
import type { ApprovedModelOption } from "@/lib/approved-model-selection";

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
    pinnedSkills: string[],
    selectedModelId?: string,
  ) => void;
  mentionTargets?: MentionTarget[];
  /** Tenant skill catalog for the `/skill` force-pin popup. */
  skillCatalog?: SkillOption[];
  spaces?: SpacesComposerSpaceOption[];
  selectedSpaceId?: string | null;
  selectedSpaceIsDefault?: boolean;
  onSelectedSpaceChange?: (spaceId: string) => void;
  approvedModels?: ApprovedModelOption[];
  selectedModelId?: string | null;
  onSelectedModelChange?: (modelId: string) => void;
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
  skillCatalog = [],
  spaces = [],
  selectedSpaceId,
  selectedSpaceIsDefault = true,
  onSelectedSpaceChange,
  approvedModels,
  selectedModelId,
  onSelectedModelChange,
  disabled = false,
  isSubmitting = false,
  error,
}: SpacesComposerProps) {
  const [mentions, setMentions] = useState<SpacesComposerMention[]>([]);
  const skillPins = useComposerSkillPins({
    value,
    onChange,
    catalog: skillCatalog,
  });
  const textareaRef = useRef<SkillTokenInputHandle | null>(null);
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
  // Escape dismisses the mention menu without committing. mentionQuery is
  // derived from the text, so we suppress the menu with a flag that resets
  // whenever the query changes.
  const [mentionMenuDismissed, setMentionMenuDismissed] = useState(false);
  const mentionMenuOpen =
    mentionQuery !== null && mentionOptions.length > 0 && !mentionMenuDismissed;
  // New threads have no history, so mode derives from the draft mentions only:
  // mentioning another user makes it multi-player (agent defaults OFF).
  const agentDefaultOn = useMemo(
    () =>
      deriveAgentDefault({
        draftMentions: mentions.map((mention) => ({
          targetType: mention.targetType,
          targetId: mention.targetId,
        })),
      }).agentDefaultOn,
    [mentions],
  );
  const [agentEnabled, setAgentEnabled] = useState(agentDefaultOn);
  // Once the user manually toggles, their choice persists until the draft is
  // cleared; until then the toggle tracks the derived default.
  const agentOverriddenRef = useRef(false);
  const agentForcedOn = hasDefaultAgentMentionAlias(value);
  const effectiveAgentEnabled = agentForcedOn || agentEnabled;

  useEffect(() => {
    setActiveMentionIndex(0);
    setMentionMenuDismissed(false);
  }, [mentionQuery, mentionOptions.length]);

  useEffect(() => {
    if (agentForcedOn) setAgentEnabled(true);
  }, [agentForcedOn]);

  // Track the derived default as draft mentions change, until manually overridden.
  useEffect(() => {
    if (!agentOverriddenRef.current) setAgentEnabled(agentDefaultOn);
  }, [agentDefaultOn]);

  // Re-runs when the textarea's disabled flag flips. Mount-time focus
  // (autoFocus + the rAF/setTimeout pair) silently no-ops while the
  // composer is disabled — e.g. on /new arrival while spaces/computers
  // are still fetching. Without re-firing on the disabled→enabled
  // transition, the textarea would sit unfocused after fetch completes
  // and the user would have to click it.
  const isComposerDisabled = disabled || isSubmitting;
  const modelSelectionBlocked =
    approvedModels !== undefined &&
    (approvedModels.length === 0 || !selectedModelId);
  const displayError =
    error ??
    (modelSelectionBlocked
      ? "No approved model is available for your account."
      : null);
  useEffect(() => {
    function focusComposerInput() {
      const input = document.querySelector<HTMLElement>(
        '[aria-label="Send message"]',
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
    if (modelSelectionBlocked) return;
    const files = await fileUiPartsToFiles(message.files);
    const hasText = value.trim().length > 0;
    if (!hasText && files.length === 0) return;
    const submittedMentions = mentions.filter((mention) =>
      value.includes(mention.rawText),
    );
    const pinnedSkills = extractPinnedSkillSlugs(value, skillCatalog);
    if (selectedModelId) {
      onSubmit(
        files,
        submittedMentions,
        effectiveAgentEnabled,
        pinnedSkills,
        selectedModelId,
      );
    } else {
      onSubmit(files, submittedMentions, effectiveAgentEnabled, pinnedSkills);
    }
    setMentions([]);
    // Fresh draft after send: drop the manual override so the next new thread
    // starts from the derived default again.
    agentOverriddenRef.current = false;
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLElement>) {
    // `@` and `/` menus are mutually exclusive (different trigger chars). When
    // the mention menu isn't open, let the skill-pin menu handle navigation.
    if (!mentionMenuOpen) {
      skillPins.handleKeyDown(event);
      return;
    }

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
    // Tab and Enter both commit the highlighted mention.
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const target =
        mentionOptions[
          Math.min(activeMentionIndex, Math.max(mentionOptions.length - 1, 0))
        ];
      if (target) selectMention(target);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMentionMenuDismissed(true);
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
        {mentionMenuOpen ? (
          <MentionMenu
            targets={mentionTargets}
            query={mentionQuery ?? ""}
            activeIndex={activeMentionIndex}
            placement="bottom"
            onSelect={selectMention}
          />
        ) : null}
        {!mentionMenuOpen && skillPins.menuOpen ? (
          <SkillMenu
            options={skillPins.options}
            query={skillPins.slashQuery ?? ""}
            activeIndex={skillPins.activeIndex}
            placement="bottom"
            onSelect={skillPins.selectSkill}
          />
        ) : null}
        <PromptInput
          // One consistent "normal" look in every state — same visible border
          // whether empty, filled, or focused, no dim fill, and no focus ring.
          // We target the inner InputGroup directly and force (`!`) the values
          // so the shared InputGroup's focus-ring + dim-bg defaults can't win.
          className="[&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:border-black/10 [&_[data-slot=input-group]]:!bg-white [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:!ring-0 [&_[data-slot=input-group]]:focus-within:border-black/20 dark:[&_[data-slot=input-group]]:border-white/10 dark:[&_[data-slot=input-group]]:!bg-[#262626] dark:[&_[data-slot=input-group]]:shadow-none dark:[&_[data-slot=input-group]]:focus-within:border-white/10"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          maxFiles={5}
          maxFileSize={25 * 1024 * 1024}
          multiple
          onSubmit={handlePromptSubmit}
          onError={(err) => {
            // Surface attach rejections instead of silently dropping the file
            // (parity with the follow-up composer). Empty/odd MIME types no
            // longer reject — see matchesAccept in prompt-input.tsx.
            toast.error(err.message);
          }}
        >
          <PromptInputBody>
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <SkillTokenInput
              ref={textareaRef}
              aria-label="Send message"
              value={value}
              onChange={onChange}
              catalog={skillCatalog}
              mentions={mentions}
              onKeyDown={handleComposerKeyDown}
              placeholder="Type @ to mention or / to pin a skill"
              disabled={isComposerDisabled}
              autoFocus
            />
          </PromptInputBody>
          <PromptInputFooter className="px-2 pb-2">
            <PromptInputTools>
              <button
                type="button"
                onClick={() => {
                  if (!agentForcedOn) {
                    agentOverriddenRef.current = true;
                    setAgentEnabled((value) => !value);
                  }
                }}
                aria-label="Send to agent"
                aria-pressed={effectiveAgentEnabled}
                title={agentToggleTitle}
                disabled={isComposerDisabled || agentForcedOn}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-opacity hover:opacity-80 disabled:pointer-events-none disabled:opacity-80",
                  effectiveAgentEnabled && "text-[#54a9ff]",
                )}
              >
                <Bot className="size-5" />
              </button>
              <PromptInputAttachButton />
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
                      "h-8 max-w-[190px] gap-1.5 rounded-md border-0 !bg-transparent px-2 text-sm shadow-none transition-opacity hover:opacity-80 focus:ring-0 dark:!bg-transparent [&>svg:last-child]:size-4",
                      spacePickerColorClass,
                    )}
                  >
                    <IconPlanet
                      stroke={2}
                      // The tabler planet glyph is optically top-heavy and sits
                      // ~1px high; nudge it down to center with the agent /
                      // attachment icons.
                      className={cn(
                        "size-5 shrink-0 translate-y-px",
                        spacePickerIconClass,
                      )}
                    />
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent
                    align="start"
                    sideOffset={6}
                    className="rounded-xl p-1.5"
                  >
                    <SelectGroup>
                      <SelectLabel className="px-2 py-1.5 text-xs text-muted-foreground">
                        Run in Space
                      </SelectLabel>
                      {spaces.map((space) => (
                        <SelectItem
                          key={space.id}
                          value={space.id}
                          className="rounded-lg py-1.5 pl-2 text-sm"
                        >
                          {space.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : null}
            </PromptInputTools>
            <div
              className="flex min-w-0 items-center gap-1"
              data-testid="composer-action-controls"
            >
              <ComposerModelPicker
                models={approvedModels}
                value={selectedModelId}
                onValueChange={onSelectedModelChange}
                disabled={disabled || isSubmitting}
              />
              <PromptInputSpeechButton
                textareaRef={
                  textareaRef as React.RefObject<HTMLTextAreaElement | null>
                }
                onTranscriptionChange={onChange}
                aria-label="Voice input"
                title="Voice input"
                className="text-muted-foreground hover:text-foreground"
                disabled={disabled || isSubmitting}
              />
              <ConditionalSubmit
                hasText={value.trim().length > 0}
                disabled={disabled || modelSelectionBlocked}
                isSubmitting={isSubmitting}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
      {displayError ? (
        <p className="text-sm text-destructive">{displayError}</p>
      ) : null}
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
  parts: Array<{
    url?: string;
    mediaType?: string;
    filename?: string;
    file?: File;
  }>,
): Promise<File[]> {
  if (!parts || parts.length === 0) return [];
  const files: File[] = [];
  for (const part of parts) {
    // Prefer the original File captured at selection time — reifying via
    // fetch(blob:/data:) is blocked by connect-src CSP in packaged desktop and
    // deployed web builds (only the dev server's loose CSP allowed it), which
    // silently dropped every attachment.
    if (part?.file instanceof File) {
      files.push(part.file);
      continue;
    }
    if (!part?.url) continue;
    try {
      const file = part.url.startsWith("data:")
        ? dataUrlToFile(part.url, part.filename, part.mediaType)
        : await (async () => {
            const response = await fetch(part.url!);
            const blob = await response.blob();
            return new File([blob], part.filename ?? "attachment", {
              type: part.mediaType ?? blob.type ?? "application/octet-stream",
            });
          })();
      if (file) files.push(file);
    } catch (err) {
      console.warn(
        `[SpacesComposer] failed to reify attached file ${part.filename}:`,
        err,
      );
    }
  }
  return files;
}

/**
 * Decode a `data:` URL into a File without `fetch()` (which connect-src CSP
 * blocks in packaged/deployed builds). Used only as a fallback when the
 * original File object isn't carried on the part.
 */
function dataUrlToFile(
  url: string,
  filename?: string,
  mediaType?: string,
): File | null {
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const header = url.slice(5, comma); // strip leading "data:"
  const isBase64 = /;base64/i.test(header);
  const mime = mediaType ?? header.split(";")[0] ?? "application/octet-stream";
  const payload = url.slice(comma + 1);
  if (!isBase64) {
    return new File([decodeURIComponent(payload)], filename ?? "attachment", {
      type: mime,
    });
  }
  const binary = atob(payload);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) view[i] = binary.charCodeAt(i);
  return new File([buffer], filename ?? "attachment", { type: mime });
}

function currentMentionQuery(content: string) {
  const match = /(?:^|\s)@([\w.'-]*)$/u.exec(content);
  return match ? match[1] : null;
}

function hasDefaultAgentMentionAlias(content: string) {
  return /(?:^|\s)@(agent|think)\b/iu.test(content);
}

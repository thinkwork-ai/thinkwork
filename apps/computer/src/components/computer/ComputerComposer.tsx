import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { IconPaperclip } from "@tabler/icons-react";

interface ComputerComposerProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Fired on submit. `files` is the user's attached File objects
   * (.xlsx / .xls / .csv only — `accept` constrains the picker).
   * Empty array when no files attached.
   */
  onSubmit: (files: File[]) => void;
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
 * BEFORE the thread exists. ComputerWorkbench's handleSubmit owns the
 * full sequence: createThread (sans firstMessage when files attached)
 * → upload via presign+finalize → sendMessage with
 * metadata.attachments → navigate.
 *
 * Submit gating: either non-empty text OR at least one attached file
 * enables submit. A file-only turn is valid; the prompt is optional.
 */
export function ComputerComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  isSubmitting = false,
  error,
}: ComputerComposerProps) {
  async function handlePromptSubmit(message: PromptInputMessage) {
    if (disabled || isSubmitting) return;
    const files = await fileUiPartsToFiles(message.files);
    const hasText = value.trim().length > 0;
    if (!hasText && files.length === 0) return;
    onSubmit(files);
  }

  return (
    <div className="grid gap-2">
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
            aria-label="Ask your Computer"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Type @ for connectors and sources"
            disabled={disabled || isSubmitting}
            autoFocus
          />
        </PromptInputBody>
        <PromptInputFooter className="px-2 pb-2">
          <PromptInputTools>
            <PromptInputAttachButton />
          </PromptInputTools>
          <ConditionalSubmit
            hasText={value.trim().length > 0}
            disabled={disabled}
            isSubmitting={isSubmitting}
          />
        </PromptInputFooter>
      </PromptInput>
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
        `[ComputerComposer] failed to reify attached file ${part.filename}:`,
        err,
      );
    }
  }
  return files;
}

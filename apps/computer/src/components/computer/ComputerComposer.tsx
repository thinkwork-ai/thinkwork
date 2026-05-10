import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";

interface ComputerComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  isSubmitting?: boolean;
  error?: string | null;
}

/**
 * Empty-thread composer (plan-012 U13). The legacy Textarea + Button
 * markup is replaced by AI Elements <PromptInput>. Submit semantics
 * are preserved: the controlled `value` / `onChange` pair drives the
 * textarea, and onSubmit fires when the user presses Enter or clicks
 * the submit button. The composer never invokes the turn-start
 * mutation directly — that's the route's responsibility via useChat
 * (single-submit invariant, P0).
 */
export function ComputerComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  isSubmitting = false,
  error,
}: ComputerComposerProps) {
  const canSubmit = value.trim().length > 0 && !disabled && !isSubmitting;

  function handlePromptSubmit(_message: PromptInputMessage) {
    if (!canSubmit) return;
    onSubmit();
  }

  return (
    <div className="grid gap-2">
      <PromptInput
        className="rounded-2xl border border-border/80 bg-background/40 shadow-sm dark:bg-input/30"
        onSubmit={handlePromptSubmit}
      >
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Ask your Computer"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Type @ for connectors and sources"
            disabled={disabled || isSubmitting}
            autoFocus
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit
            disabled={!canSubmit}
            status={isSubmitting ? "submitted" : undefined}
            aria-label={isSubmitting ? "Starting" : "Start"}
          />
        </PromptInputFooter>
      </PromptInput>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

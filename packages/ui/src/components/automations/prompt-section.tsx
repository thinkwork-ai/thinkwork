import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";

export interface PromptSectionProps {
  prompt: string;
  /**
   * Tailwind class controlling the collapsed max-height. Defaults to
   * `max-h-[6.25rem]` (~5 lines at `text-sm` line-height).
   */
  collapsedMaxClass?: string;
  /** Card title — defaults to "Prompt". */
  title?: string;
}

/**
 * Long-form prompts on a scheduled job easily run 20+ lines, which pushes
 * Run History far below the fold. The collapsed view caps the visible
 * prompt at roughly five lines (100px ≈ 5 × text-sm line-height of 20px)
 * and exposes a Show all toggle. The toggle hides itself when the prompt
 * fits within the cap so short prompts don't carry empty chrome.
 *
 * Overflow is measured with a layout-effect on a ref so the toggle never
 * flashes incorrectly on first paint.
 */
export function PromptSection({
  prompt,
  collapsedMaxClass = "max-h-[6.25rem] overflow-hidden",
  title = "Prompt",
}: PromptSectionProps) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = preRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [prompt]);

  return (
    <Card className="gap-2 py-3">
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <pre
            ref={preRef}
            className={`text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3 ${expanded ? "" : collapsedMaxClass}`}
          >
            {prompt}
          </pre>
          {!expanded && overflowing && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-md bg-gradient-to-b from-transparent to-muted/80"
            />
          )}
        </div>
        {overflowing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-7 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5 mr-1" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5 mr-1" /> Show all
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

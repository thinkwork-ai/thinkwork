import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@thinkwork/ui";
import { cn } from "@/lib/utils";

export type ComposerRuntimeValue = "pi" | "harness";

export interface ComposerRuntimePickerProps {
  value?: ComposerRuntimeValue;
  onValueChange?: (runtime: ComposerRuntimeValue) => void;
  disabled?: boolean;
  tone?: "light" | "dark";
}

/**
 * Per-turn execution runtime picker (THINK-311 U5b). Pi is the default;
 * selecting "AWS Harness" sends `metadata.requestedRuntime = "harness"`
 * on the next message so ONLY that turn runs on the AWS AgentCore
 * Harness trial path. The dispatch enforces a stage-level trial gate —
 * on non-trial stages a Harness request fails visibly in the thread.
 */
export function ComposerRuntimePicker({
  value = "pi",
  onValueChange,
  disabled = false,
  tone = "light",
}: ComposerRuntimePickerProps) {
  const isHarness = value === "harness";
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange?.(next as ComposerRuntimeValue)}
      disabled={disabled}
    >
      <SelectTrigger
        type="button"
        aria-label="Select runtime"
        title={
          isHarness
            ? "This turn runs on AWS AgentCore Harness (trial)"
            : "Execution runtime for this turn"
        }
        className={cn(
          "h-8 max-w-[150px] rounded-md border-0 !bg-transparent px-2 text-sm shadow-none transition-opacity hover:opacity-80 focus:ring-0 dark:!bg-transparent [&>svg:last-child]:size-4",
          tone === "dark"
            ? "text-white/70 hover:text-white"
            : "text-muted-foreground hover:text-foreground",
          isHarness && "text-amber-500 hover:text-amber-400",
          disabled && "pointer-events-none opacity-45",
        )}
      >
        <span className="truncate">{isHarness ? "AWS Harness" : "Pi"}</span>
      </SelectTrigger>
      <SelectContent
        align="end"
        position="popper"
        sideOffset={6}
        className="z-[70] rounded-xl p-1.5"
      >
        <SelectGroup>
          <SelectLabel className="px-2 py-1.5 text-xs text-muted-foreground">
            Runtime for this turn
          </SelectLabel>
          <SelectItem value="pi" className="rounded-lg py-1.5 pl-2 text-sm">
            <div className="grid gap-0.5">
              <span>Pi</span>
              <span className="text-xs text-muted-foreground">
                Default ThinkWork runtime
              </span>
            </div>
          </SelectItem>
          <SelectItem
            value="harness"
            className="rounded-lg py-1.5 pl-2 text-sm"
          >
            <div className="grid gap-0.5">
              <span>AWS Harness</span>
              <span className="text-xs text-muted-foreground">
                AgentCore Harness trial — this turn only
              </span>
            </div>
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

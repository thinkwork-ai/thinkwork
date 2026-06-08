import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@thinkwork/ui";
import {
  formatModelCostLine,
  formatModelProvider,
  type ApprovedModelOption,
} from "@/lib/approved-model-selection";
import { cn } from "@/lib/utils";

export interface ComposerModelPickerProps {
  models?: ApprovedModelOption[];
  value?: string | null;
  onValueChange?: (modelId: string) => void;
  disabled?: boolean;
  tone?: "light" | "dark";
}

export function ComposerModelPicker({
  models,
  value,
  onValueChange,
  disabled = false,
  tone = "light",
}: ComposerModelPickerProps) {
  if (!models) {
    return null;
  }

  const selected = models.find((model) => model.modelId === value) ?? null;
  const empty = models.length === 0;

  return (
    <Select
      value={selected?.modelId ?? ""}
      onValueChange={onValueChange}
      disabled={disabled || empty}
    >
      <SelectTrigger
        type="button"
        aria-label="Select model"
        title={
          selected
            ? `${selected.displayName} · ${formatModelCostLine(selected)}`
            : empty
              ? "No approved models"
              : "Select model"
        }
        className={cn(
          "h-8 max-w-[170px] rounded-md border-0 !bg-transparent px-2 text-sm shadow-none transition-opacity hover:opacity-80 focus:ring-0 dark:!bg-transparent [&>svg:last-child]:size-4",
          tone === "dark"
            ? "text-white/70 hover:text-white"
            : "text-muted-foreground hover:text-foreground",
          !selected && "text-destructive hover:text-destructive",
          disabled && "pointer-events-none opacity-45",
        )}
      >
        <span className="truncate">
          {selected?.displayName ?? (empty ? "No models" : "Model")}
        </span>
      </SelectTrigger>
      <SelectContent
        align="end"
        position="popper"
        sideOffset={6}
        className="z-[70] rounded-xl p-1.5"
      >
        <SelectGroup>
          <SelectLabel className="px-2 py-1.5 text-xs text-muted-foreground">
            Approved models
          </SelectLabel>
          {models.map((model) => (
            <SelectItem
              key={model.modelId}
              value={model.modelId}
              className="rounded-lg py-1.5 pl-2 text-sm"
            >
              <div className="grid gap-0.5">
                <span>{model.displayName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatModelProvider(model.provider)} ·{" "}
                  {formatModelCostLine(model)}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

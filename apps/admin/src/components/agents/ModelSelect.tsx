import { useQuery } from "urql";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelCatalogQuery } from "@/lib/graphql-queries";

/** Adapters that only support Anthropic models */
const ANTHROPIC_ONLY_ADAPTERS = new Set(["sdk"]);

const ANTHROPIC_MODEL_KEYWORDS = ["haiku", "sonnet", "opus"];

/** Check whether a model is compatible with the given adapter */
function isCompatible(modelId: string, adapterType?: string): boolean {
  if (!adapterType || !ANTHROPIC_ONLY_ADAPTERS.has(adapterType)) return true;
  const lower = modelId.toLowerCase();
  return ANTHROPIC_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
}

export function ModelSelect({
  value,
  onValueChange,
  adapterType,
  className,
}: {
  value?: string;
  onValueChange: (value: string) => void;
  adapterType?: string;
  className?: string;
}) {
  const [result] = useQuery({ query: ModelCatalogQuery });
  const models = result.data?.modelCatalog ?? [];

  const compatible = models.filter((m) => isCompatible(m.modelId, adapterType));
  const incompatible = models.filter((m) => !isCompatible(m.modelId, adapterType));

  // If current value is incompatible with newly-selected adapter, flag it
  const currentModel = models.find((m) => m.modelId === value);
  const valueIncompatible =
    currentModel && !isCompatible(currentModel.modelId, adapterType);

  return (
    <div className="space-y-1">
      <Select value={value || ""} onValueChange={onValueChange}>
        <SelectTrigger
          className={`${className ?? ""} ${valueIncompatible ? "border-destructive" : ""}`}
        >
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          {compatible.length > 0 && (
            <SelectGroup>
              {incompatible.length > 0 && (
                <SelectLabel className="text-xs text-muted-foreground">
                  Compatible
                </SelectLabel>
              )}
              {compatible.map((m) => (
                <SelectItem
                  key={m.modelId}
                  value={m.modelId}
                  className="text-sm"
                >
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {incompatible.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-xs text-muted-foreground">
                Incompatible with {adapterType} adapter
              </SelectLabel>
              {incompatible.map((m) => (
                <SelectItem
                  key={m.modelId}
                  value={m.modelId}
                  className="text-sm opacity-50"
                  disabled
                >
                  <span>{m.displayName}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      {valueIncompatible && (
        <p className="text-xs text-destructive">
          {currentModel.displayName} is not compatible with the {adapterType}{" "}
          adapter. Use the strands adapter or pick an Anthropic model.
        </p>
      )}
    </div>
  );
}

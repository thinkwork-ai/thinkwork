import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";

import type { EngagementLayer } from "../data/useTwentyEngagementData";
import { LAYERS, LAYER_STATUSES } from "../fixtures/prototype-pages";

export function OpportunityLayers({
  layers,
  onUpdateLayerStatus,
}: {
  layers: EngagementLayer[];
  onUpdateLayerStatus: (layerId: string, status: string) => Promise<unknown>;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {LAYERS.map((definition) => {
        const layer = layers.find((item) => item.layerType === definition.type);
        return (
          <article
            key={definition.type}
            className="min-h-64 rounded-md border border-border bg-card"
          >
            <div className="border-b border-border p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {definition.label}
              </div>
              <h4 className="mt-1 text-sm font-semibold text-foreground">
                {layer?.instanceName || layer?.name || "Not yet defined"}
              </h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {definition.description}
              </p>
              {layer ? (
                <Select
                  value={layer.layerStatus}
                  onValueChange={(value) =>
                    void onUpdateLayerStatus(layer.id, value)
                  }
                >
                  <SelectTrigger size="sm" className="mt-3 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LAYER_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <div className="space-y-3 p-4 text-xs leading-5">
              {layer ? (
                <>
                  <LayerField label="What We Know" value={layer.whatWeKnow} />
                  <LayerField
                    label="Open Questions"
                    value={layer.openQuestions}
                  />
                  <LayerField
                    label="Business Value"
                    value={layer.businessValue}
                  />
                  <LayerField label="Next Steps" value={layer.nextSteps} />
                </>
              ) : (
                <p className="text-muted-foreground">
                  Add this layer in Twenty CRM to map discovery evidence.
                </p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function LayerField({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div>
      <div className="font-semibold text-muted-foreground">{label}</div>
      <p className="mt-1 whitespace-pre-line text-foreground">{value}</p>
    </div>
  );
}

import {
  createAnalyticsDisplayRenderModel,
  type AnalyticsDisplayRenderModel,
} from "@thinkwork/analytics-display/react";
import {
  validateAnalyticsDisplayGenUIData,
  type ThreadGenUIData,
} from "@thinkwork/genui";

export interface AnalyticsDisplayPartProps {
  data: ThreadGenUIData;
}

export function AnalyticsDisplayPart({ data }: AnalyticsDisplayPartProps) {
  const result = validateAnalyticsDisplayGenUIData(data);

  if (!result.ok) {
    return (
      <section
        aria-label="Unsupported analytical display"
        className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground"
        data-testid="analytics-display-fallback"
      >
        <div className="font-medium text-foreground">Unsupported analytics</div>
        <p className="mt-1">
          {data.mobileFallback?.summary ??
            result.diagnostics[0]?.message ??
            "This analytical display cannot be rendered inline."}
        </p>
      </section>
    );
  }

  const model = createAnalyticsDisplayRenderModel(result.payload, {
    host: "thread",
    density: "thread",
  });

  return (
    <section
      aria-label={model.title}
      className="space-y-3 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
      data-testid="analytics-display-part"
    >
      <Header model={model} />
      <div className="grid gap-2">
        {model.elements.map((element) => (
          <article
            className="rounded-md border border-border/70 bg-background p-2"
            data-testid={`analytics-display-element-${element.type}`}
            key={element.id}
            style={{ maxHeight: element.maxHeight }}
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-foreground">
                {element.title}
              </h4>
              <span className="text-xs text-muted-foreground">
                {element.type}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {element.renderer}
              {element.rowPreviewLimit
                ? ` · ${element.rowPreviewLimit} row preview`
                : ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Header({ model }: { model: AnalyticsDisplayRenderModel }) {
  return (
    <header className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{model.title}</h3>
        <p className="text-xs text-muted-foreground">
          {model.summary.provenance} · {model.summary.freshness}
        </p>
      </div>
      {model.summary.appliedFilters?.length ? (
        <div className="flex flex-wrap gap-1" aria-label="Applied filters">
          {model.summary.appliedFilters.map((filter) => (
            <span
              className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              key={filter}
            >
              {filter}
            </span>
          ))}
        </div>
      ) : null}
      <ul className="space-y-1 text-xs text-muted-foreground">
        {model.summary.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </header>
  );
}

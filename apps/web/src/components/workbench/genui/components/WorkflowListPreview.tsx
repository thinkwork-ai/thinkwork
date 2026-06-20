export interface KeyValueListItem {
  label: string;
  value: string | number | boolean | null;
}

export interface WorkflowListPreviewProps {
  title?: string;
  items?: KeyValueListItem[];
}

export function WorkflowListPreview({
  title = "Summary",
  items = [],
}: WorkflowListPreviewProps) {
  return (
    <section
      aria-label={title}
      className="grid gap-2 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
      data-testid="genui-key-value-list"
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {items.length ? (
        <dl className="grid gap-1.5">
          {items.map((item, index) => (
            <div
              className="grid grid-cols-[minmax(7rem,0.45fr)_minmax(0,1fr)] gap-3 rounded-md bg-muted/35 px-2 py-1.5"
              key={`${item.label}-${index}`}
            >
              <dt className="min-w-0 truncate text-xs text-muted-foreground">
                {item.label}
              </dt>
              <dd className="min-w-0 break-words text-sm text-foreground">
                {formatValue(item.value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="rounded-md bg-muted/35 p-2 text-sm text-muted-foreground">
          No values.
        </p>
      )}
    </section>
  );
}

function formatValue(value: KeyValueListItem["value"]) {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

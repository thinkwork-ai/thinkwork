import type { ReactNode } from "react";

export interface KpiCard {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "risk" | "success" | "neutral";
}

export interface KpiStripProps {
  cards?: KpiCard[];
  kpis?: KpiCard[];
}

export function KpiStrip({ cards, kpis }: KpiStripProps) {
  const resolvedCards = cards ?? kpis ?? [];
  if (resolvedCards.length === 0) return null;

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {resolvedCards.map((card) => (
        <article
          key={card.label}
          className="rounded-lg border border-border/70 bg-background p-4"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {card.icon ? (
              <span className={iconClassName(card.tone)}>{card.icon}</span>
            ) : null}
            {card.label}
          </div>
          <p className="mt-3 text-2xl font-semibold tracking-tight">
            {card.value}
          </p>
          {card.detail ? (
            <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function iconClassName(tone: KpiCard["tone"]) {
  const base = "flex size-7 items-center justify-center rounded-md";
  if (tone === "risk") return `${base} bg-amber-500/10 text-amber-500`;
  if (tone === "success") return `${base} bg-emerald-500/10 text-emerald-500`;
  if (tone === "neutral") return `${base} bg-muted text-muted-foreground`;
  return `${base} bg-primary/10 text-primary`;
}

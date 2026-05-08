interface PlaceholderPageProps {
  title: string;
  subtitle?: string;
}

export function PlaceholderPage({
  title,
  subtitle = "Coming in the next phase — auth, real data, and the actual surface land in the next slice.",
}: PlaceholderPageProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {subtitle}
      </p>
    </div>
  );
}

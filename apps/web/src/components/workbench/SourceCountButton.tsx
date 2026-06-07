import { Database } from "lucide-react";
import { Button } from "@thinkwork/ui";

interface SourceCountButtonProps {
  count?: number | null;
}

export function SourceCountButton({ count }: SourceCountButtonProps) {
  const label = count && count > 0 ? `${count} sources` : "Sources";

  return (
    <Button type="button" variant="ghost" size="sm" className="gap-2" disabled>
      <Database className="size-4" />
      {label}
    </Button>
  );
}

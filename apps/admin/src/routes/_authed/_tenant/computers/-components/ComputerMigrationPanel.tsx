import { ArrowRightLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type Computer } from "@/gql/graphql";

type ComputerMigrationPanelProps = {
  computer: Pick<Computer, "migratedFromAgentId" | "migrationMetadata">;
};

function metadataEntries(metadata: unknown): [string, string][] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  return Object.entries(metadata as Record<string, unknown>).map(
    ([key, value]) => [
      key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      typeof value === "string" ? value : JSON.stringify(value),
    ],
  );
}

export function ComputerMigrationPanel({
  computer,
}: ComputerMigrationPanelProps) {
  const entries = metadataEntries(computer.migrationMetadata);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Migration Provenance</CardTitle>
        <CardDescription>
          Source Agent information preserved during Agent-to-Computer migration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          {computer.migratedFromAgentId ? (
            <Badge variant="outline" className="text-xs">
              Source Agent {computer.migratedFromAgentId}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">
              No migration source recorded.
            </span>
          )}
        </div>
        {entries.length ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            {entries.map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  {key}
                </dt>
                <dd className="mt-0.5 truncate text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}

import { Link } from "@tanstack/react-router";
import { Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type CredentialUsageCredential = {
  id: string;
  slug: string;
};

type CredentialUsageRoutine = {
  id: string;
  name: string;
  status: string;
  engine?: string | null;
  config?: unknown;
  updatedAt?: string | null;
};

type TenantCredentialUsageListProps = {
  credential: CredentialUsageCredential;
  routines: CredentialUsageRoutine[];
  loading?: boolean;
};

export function routineUsesCredential(
  routine: CredentialUsageRoutine,
  credential: CredentialUsageCredential,
): boolean {
  const haystack = JSON.stringify(routine.config ?? {});
  return haystack.includes(credential.id) || haystack.includes(credential.slug);
}

export function TenantCredentialUsageList({
  credential,
  routines,
  loading = false,
}: TenantCredentialUsageListProps) {
  const usages = routines.filter((routine) =>
    routineUsesCredential(routine, credential),
  );

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Checking routines...</p>
    );
  }

  if (usages.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        No routine references found yet.
      </div>
    );
  }

  return (
    <div className="divide-y rounded-md border">
      {usages.map((routine) => (
        <div
          key={routine.id}
          className="flex flex-wrap items-center justify-between gap-3 p-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{routine.name}</span>
              <Badge variant="outline" className="text-xs">
                {routine.status.toLowerCase()}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Matched this credential in routine configuration.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link
              to="/automations/routines/$routineId"
              params={{ routineId: routine.id }}
            >
              Open
            </Link>
          </Button>
        </div>
      ))}
    </div>
  );
}

import { TenantCredentialStatus } from "@/gql/graphql";
import { Badge } from "@/components/ui/badge";

export function TenantCredentialStatusBadge({
  status,
}: {
  status: TenantCredentialStatus;
}) {
  if (status === TenantCredentialStatus.Active) {
    return (
      <Badge
        variant="secondary"
        className="bg-green-500/15 text-green-700 dark:text-green-400"
      >
        Active
      </Badge>
    );
  }

  if (status === TenantCredentialStatus.Disabled) {
    return (
      <Badge variant="secondary" className="bg-muted text-muted-foreground">
        Disabled
      </Badge>
    );
  }

  return <Badge variant="outline">Deleted</Badge>;
}

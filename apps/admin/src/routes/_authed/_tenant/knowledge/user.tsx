import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "urql";
import { Loader2, UserRound } from "lucide-react";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { TenantMembersListQuery } from "@/lib/graphql-queries";

type UserScope = {
  userId: string;
  label: string;
};

export const Route = createFileRoute("/_authed/_tenant/knowledge/user")({
  component: UserContextPage,
  validateSearch: (search: Record<string, unknown>): { user?: string } => ({
    ...(typeof search.user === "string" && search.user
      ? { user: search.user }
      : {}),
  }),
});

function UserContextPage() {
  const { tenantId } = useTenant();
  const { user } = useSearch({ strict: false }) as { user?: string };
  const navigate = useNavigate();

  useBreadcrumbs([
    { label: "Memory", href: "/knowledge/memory" },
    { label: "User" },
  ]);

  const [membersResult] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const userScopes = useMemo<UserScope[]>(() => {
    const members = membersResult.data?.tenantMembers ?? [];
    return members
      .filter(
        (member) =>
          member.principalType.toLowerCase() === "user" && member.user,
      )
      .map((member) => ({
        userId: member.user!.id,
        label: member.user!.name ?? member.user!.email,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [membersResult.data]);

  const selectedUser = userScopes.find((scope) => scope.userId === user);
  const selectedUserId = selectedUser?.userId ?? "";

  const setSelectedUser = (nextUserId: string) => {
    navigate({
      to: "/knowledge/user",
      search: nextUserId ? { user: nextUserId } : {},
      replace: true,
    });
  };

  if (!tenantId || (membersResult.fetching && !membersResult.data)) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-3">
      <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">User context</span>
          <span className="truncate text-xs text-muted-foreground">
            {selectedUser
              ? `${selectedUser.label} local memory files`
              : "Select a user to inspect local memory files."}
          </span>
        </div>
        <Select
          value={selectedUserId || "__none"}
          onValueChange={(value) =>
            setSelectedUser(value === "__none" ? "" : value)
          }
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select user" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Select user</SelectItem>
            {userScopes.map((scope) => (
              <SelectItem key={scope.userId} value={scope.userId}>
                {scope.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1">
        {membersResult.fetching && !membersResult.data ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading users...
          </div>
        ) : selectedUserId ? (
          <WorkspaceEditor
            target={{ userId: selectedUserId }}
            mode="context"
            className="h-full min-h-0"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <UserRound className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Select a user to inspect local memory files.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

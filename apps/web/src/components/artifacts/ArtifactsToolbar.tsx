import { Search, User } from "lucide-react";
import { Input } from "@thinkwork/ui";

export interface ArtifactsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /**
   * Operator-only: show a "filter by user ID" input. Distinct from the
   * content `search` field — this scopes the list to one user's applets via
   * the admin query. Hidden for non-operators.
   */
  showUserFilter?: boolean;
  userIdFilter?: string;
  onUserIdFilterChange?: (value: string) => void;
}

// Artifacts has a single kind (`applet`) today, so the toolbar carries only
// content search plus the operator user-ID filter — no kind tabs or dropdown.
export function ArtifactsToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search artifacts…",
  showUserFilter = false,
  userIdFilter = "",
  onUserIdFilterChange,
}: ArtifactsToolbarProps) {
  return (
    <div
      className="relative z-10 flex shrink-0 flex-wrap items-center gap-3 px-6 py-3"
      data-testid="artifacts-toolbar"
    >
      <div className="relative w-fit min-w-56 max-w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9"
          data-testid="artifacts-search"
        />
      </div>

      {showUserFilter ? (
        <div
          className="relative w-fit min-w-52"
          data-testid="artifacts-user-filter"
        >
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Filter by user ID"
            value={userIdFilter}
            onChange={(event) => onUserIdFilterChange?.(event.target.value)}
            className="pl-9"
            data-testid="artifacts-user-filter-input"
          />
        </div>
      ) : null}
    </div>
  );
}
